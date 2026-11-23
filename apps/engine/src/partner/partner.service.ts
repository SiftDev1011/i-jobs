import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ageBandFor } from '../account/account.service';
import { randomToken } from '../common/crypto';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { RedisService } from '../redis/redis.service';

const LINK_DAYS = 7;
const linkKey = (token: string) => `partner-link:${token}`;

export interface LinkInput {
  external_user_id: string;
  email: string;
  email_verified: boolean;
  full_name?: string;
  date_of_birth?: string;
  completed_trainings?: string[];
}

interface PendingLink { siteId: string; externalUserId: string; userId: string; completed: string[] }

/** Partner sites link their users to i-jobs people. An existing person must agree first. */
@Injectable()
export class PartnerService {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async link(siteId: string, input: LinkInput) {
    if (!input.email_verified) throw Problem.unprocessable('email_not_verified', 'Only link users whose email you have verified');
    const email = input.email.trim().toLowerCase();
    const completed = [...new Set(input.completed_trainings ?? [])].slice(0, 500);

    const existing = await this.db.forSite(siteId, (trx) =>
      trx.selectFrom('site_accounts').select(['user_id']).where('site_id', '=', siteId).where('external_user_id', '=', input.external_user_id).executeTakeFirst(),
    );
    if (existing) {
      if (input.completed_trainings) await this.db.forSite(siteId, (trx) => trx.updateTable('site_accounts').set({ completed_trainings: completed }).where('site_id', '=', siteId).where('external_user_id', '=', input.external_user_id).execute());
      return { user_id: existing.user_id, linked: true, consent_url: null };
    }

    const person = await this.db.asEngine((trx) => trx.selectFrom('users').select(['id', 'status']).where('email', '=', email).executeTakeFirst());
    if (!person) {
      // New to i-jobs: create them, already linked to this site.
      const userId = await this.db.asEngine(async (trx) => {
        const u = await trx.insertInto('users').values({
          email, email_verified_at: sql`now()`, full_name: input.full_name?.trim().slice(0, 120) || null,
          date_of_birth: input.date_of_birth ?? null, ...(input.date_of_birth ? { age_band: ageBandFor(input.date_of_birth) } : {}),
        }).returning('id').executeTakeFirstOrThrow();
        await trx.insertInto('site_accounts').values({ site_id: siteId, user_id: u.id, external_user_id: input.external_user_id, completed_trainings: completed }).execute();
        await trx.insertInto('consents').values({ user_id: u.id, site_id: siteId, purpose: 'cross_site_linking', granted: true, policy_version: 'partner-signup-v1' }).execute();
        return u.id;
      });
      return { user_id: userId, linked: true, consent_url: null };
    }
    if (person.status !== 'active') throw Problem.conflict('account_unavailable', 'This person cannot be linked right now');

    const already = await this.db.asEngine((trx) => trx.selectFrom('site_accounts').select('external_user_id').where('site_id', '=', siteId).where('user_id', '=', person.id).executeTakeFirst());
    if (already) throw Problem.conflict('already_linked', 'This person is already linked to another of your users');

    // Someone already has i-jobs: ask them. The partner learns nothing about them until they agree.
    const token = randomToken(24);
    const pending: PendingLink = { siteId, externalUserId: input.external_user_id, userId: person.id, completed };
    await this.redis.client.set(linkKey(token), JSON.stringify(pending), 'EX', LINK_DAYS * 86400);
    const site = await this.siteName(siteId);
    const consentUrl = `${this.config.PUBLIC_APP_URL}/link/${token}`;
    await this.mail.send({
      to: email,
      subject: `Link your i-jobs account to ${site}?`,
      text: `${site} asked to link your account there to your i-jobs account, so your profile, matches and applications show up on ${site} too.\n\nIf this was you, agree here (the link works for ${LINK_DAYS} days):\n${consentUrl}\n\nIf it wasn't you, ignore this email. Nothing is shared unless you agree.`,
    });
    return { user_id: null, linked: false, consent_url: consentUrl };
  }

  /** What the person sees before agreeing. */
  async preview(userId: string, token: string) {
    const p = await this.pending(token, userId);
    return { site: await this.siteName(p.siteId), shares: ['profile', 'matches', 'applications', 'notifications'] };
  }

  async accept(userId: string, token: string) {
    const p = await this.pending(token, userId);
    await this.db.asEngine(async (trx) => {
      await trx.insertInto('site_accounts').values({ site_id: p.siteId, user_id: p.userId, external_user_id: p.externalUserId, completed_trainings: p.completed })
        .onConflict((oc) => oc.doNothing()).execute();
      await trx.insertInto('consents').values({ user_id: p.userId, site_id: p.siteId, purpose: 'cross_site_linking', granted: true, policy_version: 'partner-link-v1' }).execute();
    });
    await this.redis.client.del(linkKey(token));
    return { linked: true, site: await this.siteName(p.siteId) };
  }

  async decline(userId: string, token: string) {
    await this.pending(token, userId);
    await this.redis.client.del(linkKey(token));
  }

  private async pending(token: string, userId: string): Promise<PendingLink> {
    const raw = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await this.redis.client.get(linkKey(token)) : null;
    if (!raw) throw Problem.notFound('link_expired', 'This link has expired or was already used');
    const p = JSON.parse(raw) as PendingLink;
    if (p.userId !== userId) throw Problem.forbidden('wrong_account', 'Sign in with the account this link was sent to');
    return p;
  }

  private async siteName(siteId: string) {
    const s = await this.db.asEngine((trx) => trx.selectFrom('sites').select('name').where('id', '=', siteId).executeTakeFirst());
    return s?.name ?? 'A partner site';
  }
}

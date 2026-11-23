import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { revokedSessionKey } from '../auth/auth.guard';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { RedisService } from '../redis/redis.service';
import { SitesService } from '../sites/sites.service';
import { StorageService } from '../storage/storage.service';

const LINK_SECONDS = 7 * 86400; // the longest a signed R2 link can last
export const DELETE_WAIT_HOURS = 48;

/**
 * Data requests (NDPA / GDPR):
 * - export: everything we hold about the member, as one JSON file, emailed as a 7-day link.
 * - delete: after 48 hours (so support can stop a mistaken or hijacked request), the member is
 *   anonymised. Payments and the ledger stay: the law and the owners' payouts need them.
 * - correct, human_review: a person handles these; we open a ticket.
 */
@Injectable()
export class DataRequestsService {
  private readonly logger = new Logger('DataRequests');

  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly redis: RedisService,
    private readonly sites: SitesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async processDue(limit = 20): Promise<Record<string, number>> {
    const due = await this.db.asEngine((trx) =>
      trx.updateTable('data_requests').set({ status: 'in_progress' })
        .where('id', 'in', (eb) => eb.selectFrom('data_requests').select('id').where('status', '=', 'received').where('process_after', '<=', sql<Date>`now()`).orderBy('created_at').limit(limit))
        .returning(['id', 'user_id', 'type', 'details']).execute(),
    );
    const out: Record<string, number> = {};
    for (const r of due) {
      try {
        if (r.type === 'export') await this.export(r.id, r.user_id);
        else if (r.type === 'delete') await this.erase(r.id, r.user_id);
        else await this.toPerson(r.id, r.user_id, r.type, r.details);
        out[r.type] = (out[r.type] ?? 0) + 1;
      } catch (e) {
        this.logger.error(`data request ${r.id} (${r.type}) failed: ${(e as Error).message}`);
        await this.db.asEngine((trx) => trx.updateTable('data_requests').set({ status: 'received', process_after: sql`now() + interval '1 hour'` }).where('id', '=', r.id).execute());
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- export

  async export(requestId: string, userId: string) {
    const bundle = await this.db.asEngine(async (trx) => {
      const q = <T>(p: Promise<T>) => p;
      const [user, profile, rules, matches, applications, events, packs, memberships, payments, consents, notifications, tickets, sites, requests] = await Promise.all([
        q(trx.selectFrom('users').select(['id', 'email', 'phone', 'full_name', 'date_of_birth', 'age_band', 'status', 'created_at']).where('id', '=', userId).executeTakeFirst()),
        q(trx.selectFrom('profiles').select(['headline', 'summary', 'years_experience', 'country', 'city', 'timezone', 'work_authorization', 'skills', 'experience', 'education', 'languages', 'links', 'strength', 'confirmed_at', 'updated_at']).where('user_id', '=', userId).executeTakeFirst()),
        q(trx.selectFrom('autopilot_rules').select(['enabled', 'min_match', 'min_pay_monthly_minor', 'pay_currency', 'regions', 'include_unspecified', 'employment_types', 'daily_cap', 'paused_until', 'updated_at']).where('user_id', '=', userId).executeTakeFirst()),
        q(trx.selectFrom('matches as m').innerJoin('jobs as j', 'j.id', 'm.job_id').select(['j.title', 'j.company_name', 'm.score', 'm.reasons', 'm.gaps', 'm.status', 'm.computed_at']).where('m.user_id', '=', userId).execute()),
        q(trx.selectFrom('applications as a').innerJoin('jobs as j', 'j.id', 'a.job_id').select(['a.id', 'j.title', 'j.company_name', 'a.mode', 'a.channel', 'a.status', 'a.content', 'a.sent_at', 'a.created_at']).where('a.user_id', '=', userId).execute()),
        q(trx.selectFrom('application_events as e').innerJoin('applications as a', 'a.id', 'e.application_id').select(['e.application_id', 'e.from_status', 'e.to_status', 'e.note', 'e.at']).where('a.user_id', '=', userId).execute()),
        q(trx.selectFrom('apply_packs as p').innerJoin('jobs as j', 'j.id', 'p.job_id').select(['j.title', 'j.company_name', 'p.answers', 'p.generated_at']).where('p.user_id', '=', userId).execute()),
        q(trx.selectFrom('memberships as m').innerJoin('communities as c', 'c.id', 'm.community_id').select(['c.name as community', 'm.status', 'm.source', 'm.trial_started_at', 'm.current_period_start', 'm.current_period_end', 'm.created_at']).where('m.user_id', '=', userId).execute()),
        q(trx.selectFrom('payments').select(['purpose', 'amount_kobo', 'currency', 'status', 'provider', 'paid_at', 'created_at']).where('user_id', '=', userId).execute()),
        q(trx.selectFrom('consents').select(['purpose', 'granted', 'policy_version', 'created_at']).where('user_id', '=', userId).orderBy('created_at').execute()),
        q(trx.selectFrom('notifications').select(['type', 'title', 'body', 'created_at', 'read_at']).where('user_id', '=', userId).execute()),
        q(trx.selectFrom('support_tickets').select(['id', 'subject', 'category', 'status', 'created_at']).where('user_id', '=', userId).execute()),
        q(trx.selectFrom('site_accounts as sa').innerJoin('sites as s', 's.id', 'sa.site_id').select(['s.name as site', 'sa.linked_at']).where('sa.user_id', '=', userId).execute()),
        q(trx.selectFrom('data_requests').select(['type', 'status', 'created_at', 'completed_at']).where('user_id', '=', userId).execute()),
      ]);
      const messages = tickets.length
        ? await trx.selectFrom('support_messages').select(['ticket_id', 'author', 'body', 'at']).where('ticket_id', 'in', tickets.map((t) => t.id)).orderBy('at').execute()
        : [];
      return {
        generated_at: new Date().toISOString(),
        about: 'Everything i-jobs holds about you. Your CV file is linked separately while it exists. Contact support with questions.',
        account: user, profile, autopilot_rules: rules, matches, applications, application_history: events, apply_packs: packs,
        memberships, payments, consents, notifications, linked_sites: sites, data_requests: requests,
        support_tickets: tickets.map((t) => ({ ...t, messages: messages.filter((m) => m.ticket_id === t.id).map(({ ticket_id: _t, ...m }) => m) })),
      };
    });
    const key = `exports/${userId}/${requestId}.json`;
    await this.storage.put(key, Buffer.from(JSON.stringify(bundle, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)), 'application/json');
    const url = await this.storage.downloadUrl(key, 'i-jobs-data.json', LINK_SECONDS);
    await this.db.asEngine(async (trx) => {
      await trx.updateTable('data_requests').set({ status: 'done', completed_at: sql`now()`, result_key: key }).where('id', '=', requestId).execute();
      await this.notify(trx, userId, 'data.export_ready', 'Your data is ready to download', 'The download link works for 7 days. You can also find it under Privacy in your account.');
    });
    if (bundle.account?.email) {
      await this.mail.send({ to: bundle.account.email, subject: 'Your i-jobs data is ready', text: `Here is a copy of everything i-jobs holds about you:\n${url}\n\nThe link works for 7 days. If you didn't ask for this, contact support right away.` });
    }
  }

  /** A fresh link for a finished export (the list endpoint). */
  async downloadUrl(resultKey: string | null): Promise<string | null> {
    return resultKey ? this.storage.downloadUrl(resultKey, 'i-jobs-data.json', 3600) : null;
  }

  // ---------------------------------------------------------------- delete

  async erase(requestId: string, userId: string) {
    const blockers = await this.db.asEngine(async (trx) => {
      const [owner, staff, employer] = await Promise.all([
        trx.selectFrom('owner_profiles').select('user_id').where('user_id', '=', userId).executeTakeFirst(),
        trx.selectFrom('staff_members').select('user_id').where('user_id', '=', userId).executeTakeFirst(),
        trx.selectFrom('employer_members').select('employer_id').where('user_id', '=', userId).where('role', '=', 'owner').executeTakeFirst(),
      ]);
      return [owner && 'community owner (communities, payouts and ID documents need a handover)', staff && 'staff member', employer && 'employer account owner'].filter(Boolean) as string[];
    });
    if (blockers.length) return this.toPerson(requestId, userId, 'delete', `Can't delete automatically: ${blockers.join('; ')}`);

    const user = await this.db.asEngine((trx) => trx.selectFrom('users').select(['email']).where('id', '=', userId).executeTakeFirst());
    const { files, sessions } = await this.db.asEngine(async (trx) => {
      const files: string[] = [];
      const profile = await trx.selectFrom('profiles').select('cv_file_key').where('user_id', '=', userId).executeTakeFirst();
      if (profile?.cv_file_key) files.push(profile.cv_file_key);
      for (const p of await trx.selectFrom('apply_packs').select('tailored_cv_key').where('user_id', '=', userId).where('tailored_cv_key', 'is not', null).execute()) files.push(p.tailored_cv_key!);
      for (const m of await trx.selectFrom('email_messages').select('raw_key').where('user_id', '=', userId).where('raw_key', 'is not', null).execute()) files.push(m.raw_key!);
      for (const r of await trx.selectFrom('data_requests').select('result_key').where('user_id', '=', userId).where('result_key', 'is not', null).execute()) files.push(r.result_key!);
      const sessions = await trx.selectFrom('sessions').select('id').where('user_id', '=', userId).execute();

      // Stop anything still waiting to be sent for them.
      await trx.updateTable('applications').set({ status: 'cancelled', cancelled_at: sql`now()`, failed_reason: 'account_deleted' }).where('user_id', '=', userId).where('status', '=', 'scheduled').execute();
      // Keep the application rows (employers and owners counted them), but not what was written in them.
      await trx.updateTable('applications').set({ content: '{}' }).where('user_id', '=', userId).execute();
      await trx.updateTable('application_events').set({ note: null }).where('application_id', 'in', (eb) => eb.selectFrom('applications').select('id').where('user_id', '=', userId)).execute();
      for (const table of ['profiles', 'matches', 'apply_packs', 'notifications', 'sessions', 'site_accounts', 'autopilot_rules', 'work_items', 'guardian_consents', 'employer_members', 'email_messages'] as const) {
        await trx.deleteFrom(table).where('user_id', '=', userId).execute();
      }
      // The relay address stays reserved (so it's never reused) but stops forwarding.
      await trx.updateTable('relay_addresses').set({ active: false }).where('user_id', '=', userId).execute();
      await trx.updateTable('memberships').set({ status: 'cancelled', cancelled_at: sql`now()` }).where('user_id', '=', userId).where('status', 'not in', ['expired', 'cancelled']).execute();
      await trx.updateTable('support_messages').set({ body: '[deleted at the member’s request]' }).where('author', '=', 'user').where('ticket_id', 'in', (eb) => eb.selectFrom('support_tickets').select('id').where('user_id', '=', userId)).execute();
      await trx.updateTable('support_tickets').set({ subject: '[deleted]' }).where('user_id', '=', userId).execute();
      await trx.updateTable('users').set({
        email: `deleted-${userId}@deleted.invalid`, email_verified_at: null, phone: null, phone_verified_at: null, full_name: null, date_of_birth: null,
        status: 'deleted', deleted_at: sql`now()`, updated_at: sql`now()`,
      }).where('id', '=', userId).execute();
      await trx.updateTable('data_requests').set({ status: 'done', completed_at: sql`now()`, result_key: null }).where('user_id', '=', userId).where('id', '=', requestId).execute();
      await trx.insertInto('audit_log').values({ actor_user_id: null, actor_kind: 'system', action: 'user.deleted', subject_type: 'user', subject_id: userId, meta: JSON.stringify({ request: requestId, files: files.length }) }).execute();
      return { files, sessions };
    });
    // Signed-in devices stop working now, not when their token runs out.
    for (const s of sessions) await this.redis.client.set(revokedSessionKey(s.id), '1', 'EX', this.config.ACCESS_TOKEN_MINUTES * 60 + 60);
    for (const key of files) await this.storage.delete(key).catch((e) => this.logger.warn(`could not delete ${key}: ${(e as Error).message}`));
    if (user?.email) await this.mail.send({ to: user.email, subject: 'Your i-jobs account has been deleted', text: 'Your i-jobs account and the data in it have been deleted, as you asked. We keep payment records because the law requires it.\n\nThis is the last email we will send you.' });
  }

  // ---------------------------------------------------------------- people

  private async toPerson(requestId: string, userId: string, type: string, details: string | null) {
    const site = await this.sites.ijobs();
    await this.db.asEngine(async (trx) => {
      const t = await trx.insertInto('support_tickets').values({ user_id: userId, site_id: site.id, subject: `Data request: ${type.replace('_', ' ')}`, category: 'data_request', status: 'waiting_human', escalated_at: sql`now()` }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('support_messages').values({ ticket_id: t.id, author: 'bot', body: `Data request ${requestId} (${type}). ${details ?? 'No details given.'} Answer within the due date; mark the request done or refused when finished.` }).execute();
      await this.notify(trx, userId, 'data.request_received', 'A person is handling your request', 'We will reply on your support ticket.');
    });
  }

  private notify(trx: Parameters<Parameters<Db['asEngine']>[0]>[0], userId: string, type: string, title: string, body: string) {
    return this.sites.ijobs().then((s) => trx.insertInto('notifications').values({ user_id: userId, site_id: s.id, type, title, body }).execute());
  }
}

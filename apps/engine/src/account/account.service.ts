import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AppConfig, CONFIG } from '../config/config';
import { hmacHex, randomToken } from '../common/crypto';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import type { AgeBand, ConsentPurpose, DataRequestType } from '../db/schema';
import { MailService } from '../messaging/mail.service';
import { SitesService } from '../sites/sites.service';
import { StorageService } from '../storage/storage.service';

/** Age band from a date of birth, in whole years as of `today` (UTC). */
export function ageBandFor(dateOfBirth: string, today = new Date()): AgeBand {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  if (age < 13) return 'under_13';
  if (age < 18) return 'teen';
  return 'adult';
}

export interface MeView {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  age_band: AgeBand;
  features_locked: boolean;
  is_owner: boolean;
  is_staff: boolean;
  staff_role: string | null;
  is_employer: boolean;
  relay_address: string | null;
  active_membership: MembershipView | null;
}

export interface MembershipView {
  id: string;
  community: { id: string; name: string; slug: string };
  status: string;
  source: string;
  onboarding_step: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  switch_offer: boolean;
}

const GUARDIAN_LINK_DAYS = 14;

@Injectable()
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly sites: SitesService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async getMe(userId: string, siteId: string): Promise<MeView> {
    const user = await this.db.k
      .selectFrom('users')
      .select(['id', 'email', 'phone', 'full_name', 'age_band', 'status'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.status === 'deleted') throw Problem.notFound('user_not_found', 'This account no longer exists');

    const [owner, staff, employer, relay, guardian, site, membership] = await Promise.all([
      this.db.k.selectFrom('owner_profiles').select('user_id').where('user_id', '=', userId).executeTakeFirst(),
      this.db.k.selectFrom('staff_members').select(['user_id', 'role']).where('user_id', '=', userId).executeTakeFirst(),
      this.db.asEngine((trx) => trx.selectFrom('employer_members').select('employer_id').where('user_id', '=', userId).where('domain_email_verified_at', 'is not', null).executeTakeFirst()),
      this.db.k
        .selectFrom('relay_addresses')
        .select(['local_part', 'domain'])
        .where('user_id', '=', userId)
        .where('active', '=', true)
        .executeTakeFirst(),
      this.db.k
        .selectFrom('guardian_consents')
        .select('id')
        .where('user_id', '=', userId)
        .where('status', '=', 'approved')
        .executeTakeFirst(),
      this.db.k.selectFrom('sites').select('allows_minors').where('id', '=', siteId).executeTakeFirst(),
      this.activeMembership(userId),
    ]);

    const featuresLocked =
      user.age_band === 'under_13' || (user.age_band === 'teen' && (!guardian || !site?.allows_minors));

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      full_name: user.full_name,
      age_band: user.age_band,
      features_locked: featuresLocked,
      is_owner: !!owner,
      is_staff: !!staff,
      staff_role: staff?.role ?? null,
      is_employer: !!employer,
      relay_address: relay ? `${relay.local_part}@${relay.domain}` : null,
      active_membership: membership,
    };
  }

  async activeMembership(userId: string): Promise<MembershipView | null> {
    const row = await this.db.k
      .selectFrom('memberships as m')
      .innerJoin('communities as c', 'c.id', 'm.community_id')
      .select([
        'm.id',
        'm.status',
        'm.source',
        'm.onboarding_step',
        'm.trial_ends_at',
        'm.current_period_end',
        'c.id as community_id',
        'c.name as community_name',
        'c.slug as community_slug',
        'c.status as community_status',
      ])
      .where('m.user_id', '=', userId)
      .where('m.status', 'in', ['active', 'trialing', 'past_due'])
      .orderBy('m.created_at', 'desc')
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      community: { id: row.community_id, name: row.community_name, slug: row.community_slug },
      status: row.status,
      source: row.source,
      onboarding_step: row.onboarding_step,
      trial_ends_at: row.trial_ends_at,
      current_period_end: row.current_period_end,
      switch_offer: row.community_status === 'banned',
    };
  }

  async updateMe(
    userId: string,
    siteId: string,
    patch: { full_name?: string; phone?: string; date_of_birth?: string },
  ): Promise<MeView> {
    const values: Record<string, unknown> = {};
    if (patch.full_name !== undefined) values.full_name = patch.full_name.trim();
    if (patch.phone !== undefined) {
      values.phone = patch.phone;
      values.phone_verified_at = null;
    }
    if (patch.date_of_birth !== undefined) {
      const dob = new Date(`${patch.date_of_birth}T00:00:00Z`);
      if (Number.isNaN(dob.getTime()) || dob > new Date() || dob.getUTCFullYear() < 1900) {
        throw Problem.badRequest('invalid_request', 'Some fields are missing or invalid', [
          { field: 'date_of_birth', message: 'Enter a real date of birth' },
        ]);
      }
      values.date_of_birth = patch.date_of_birth;
      values.age_band = ageBandFor(patch.date_of_birth);
    }
    if (Object.keys(values).length) {
      try {
        await this.db.k.updateTable('users').set(values).where('id', '=', userId).execute();
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw Problem.conflict('phone_in_use', 'This phone number is already on another account');
        throw e;
      }
    }
    return this.getMe(userId, siteId);
  }

  listConsents(userId: string) {
    return this.db.k
      .selectFrom('current_consents')
      .select(['purpose', 'granted', 'policy_version', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('purpose')
      .execute();
  }

  /**
   * Records a consent answer. Withdrawing autopilot consent switches autopilot off
   * and cancels every autopilot application that hasn't been sent yet.
   */
  async recordConsent(
    userId: string,
    siteId: string,
    input: { purpose: ConsentPurpose; granted: boolean; policy_version: string },
    ip?: string,
  ) {
    return this.db.asEngine(async (trx) => {
      const row = await trx
        .insertInto('consents')
        .values({
          user_id: userId,
          site_id: siteId,
          purpose: input.purpose,
          granted: input.granted,
          policy_version: input.policy_version,
          ip_hash: ip ? hmacHex(this.config.AUTH_PEPPER, ip) : null,
        })
        .returning(['purpose', 'granted', 'policy_version', 'created_at'])
        .executeTakeFirstOrThrow();

      if (input.purpose === 'autopilot' && !input.granted) {
        await trx.updateTable('autopilot_rules').set({ enabled: false }).where('user_id', '=', userId).execute();
        await trx
          .updateTable('applications')
          .set({ status: 'cancelled', cancelled_at: sql`now()` })
          .where('user_id', '=', userId)
          .where('mode', '=', 'autopilot')
          .where('status', '=', 'scheduled')
          .execute();
      }
      return row;
    });
  }

  /** Emails a parent a link to approve job features for a 13 to 17 year old. */
  async requestGuardianApproval(userId: string, input: { guardian_name: string; guardian_email: string }) {
    const user = await this.db.k
      .selectFrom('users')
      .select(['age_band', 'full_name'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (user.age_band !== 'teen') {
      throw Problem.conflict('guardian_not_needed', "A parent's approval is only needed for 13 to 17 year olds");
    }
    const token = randomToken(32);
    await this.db.k.transaction().execute(async (trx) => {
      await trx
        .updateTable('guardian_consents')
        .set({ status: 'expired' })
        .where('user_id', '=', userId)
        .where('status', '=', 'pending')
        .execute();
      await trx
        .insertInto('guardian_consents')
        .values({
          user_id: userId,
          guardian_name: input.guardian_name,
          guardian_email: input.guardian_email,
          token_hash: hmacHex(this.config.AUTH_PEPPER, token),
        })
        .execute();
    });
    const link = `${this.config.PUBLIC_APP_URL}/guardian?token=${encodeURIComponent(token)}`;
    const who = user.full_name?.split(' ')[0] || 'Your child';
    await this.mail.send({
      to: input.guardian_email,
      subject: `${who} asked for your approval on i-jobs`,
      text:
        `Hello ${input.guardian_name},\n\n` +
        `${who} wants to use i-jobs to find internships and training suited to people under 18. ` +
        `Because they are under 18, they need your approval first.\n\n` +
        `Review and approve or decline here (the link works for ${GUARDIAN_LINK_DAYS} days):\n${link}\n\n` +
        `If you don't know what this is, you can ignore this email.\n\ni-jobs by 99`,
    });
  }

  /** The parent's answer, from the emailed link. Records a 'guardian' consent for the teen. */
  async decideGuardian(token: string, approve: boolean) {
    const hash = hmacHex(this.config.AUTH_PEPPER, token);
    return this.db.k.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('guardian_consents')
        .select(['id', 'user_id', 'created_at'])
        .where('token_hash', '=', hash)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      const expired = row && Date.now() - row.created_at.getTime() > GUARDIAN_LINK_DAYS * 86400_000;
      if (!row || expired) throw Problem.notFound('link_expired', 'This approval link has expired or was already used');
      await trx
        .updateTable('guardian_consents')
        .set({ status: approve ? 'approved' : 'declined', decided_at: sql`now()` })
        .where('id', '=', row.id)
        .execute();
      await trx
        .insertInto('consents')
        .values({ user_id: row.user_id, purpose: 'guardian', granted: approve, policy_version: 'guardian-v1' })
        .execute();
      return { decision: approve ? 'approved' : 'declined' };
    });
  }

  async listDataRequests(userId: string) {
    const rows = await this.db.k
      .selectFrom('data_requests')
      .select(['id', 'type', 'status', 'due_at', 'completed_at', 'result_key'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
    return Promise.all(rows.map(async ({ result_key, ...r }) => ({
      ...r,
      download_url: r.type === 'export' && r.status === 'done' && result_key ? await this.storage.downloadUrl(result_key, 'i-jobs-data.json', 3600) : null,
    })));
  }

  async createDataRequest(userId: string, input: { type: DataRequestType; details?: string }) {
    const open = await this.db.k
      .selectFrom('data_requests')
      .select('id')
      .where('user_id', '=', userId)
      .where('type', '=', input.type)
      .where('status', 'in', ['received', 'in_progress'])
      .executeTakeFirst();
    if (open) throw Problem.conflict('request_already_open', 'You already have one of these requests in progress');
    const row = await this.db.k
      .insertInto('data_requests')
      // Deletion waits 48 hours so a mistaken or hijacked request can still be stopped.
      .values({ user_id: userId, type: input.type, details: input.details ?? null, process_after: input.type === 'delete' ? sql`now() + interval '48 hours'` : sql`now()` })
      .returning(['id', 'type', 'status', 'due_at', 'completed_at'])
      .executeTakeFirstOrThrow();
    if (input.type === 'delete') {
      const user = await this.db.k.selectFrom('users').select('email').where('id', '=', userId).executeTakeFirst();
      if (user?.email) {
        await this.mail.send({
          to: user.email,
          subject: 'Your i-jobs account will be deleted in 48 hours',
          text: 'You asked us to delete your i-jobs account. We will do it in 48 hours.\n\nIf you did not ask for this, or changed your mind, reply to this email or contact support before then and we will stop it.',
        });
      }
    }
    return { ...row, download_url: null };
  }
}

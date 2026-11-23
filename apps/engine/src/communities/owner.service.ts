import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AiService, nextUtcMidnight } from '../ai/ai.service';
import { hmacHex, randomToken } from '../common/crypto';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { SmsService } from '../messaging/sms.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { RedisService } from '../redis/redis.service';
import { PagaClient } from '../money/paga';
import { inviteCode, maskTarget, money, PERIOD_DAYS } from './shared';

const NUDGE_EVERY_DAYS = 3;
const PASTED_JOB_DAYS = 21;

export interface OwnerApplicationInput {
  legal_name: string;
  id_type: string;
  id_number: string;
  id_document_upload_id?: string;
  bank_code?: string;
  bank_account_number?: string;
  community_name: string;
  slug: string;
  description?: string;
  proof_links: string[];
  claimed_member_count?: number;
  group_started_on?: string;
  evidence_upload_ids?: string[];
  price: { amount_minor: number; currency: string };
  billing_period: 'monthly' | 'quarterly' | 'yearly';
  trial_enabled?: boolean;
  approval_required?: boolean;
}

/** Everything a community owner does. Owners see first names and progress only, never contact details. */
@Injectable()
export class OwnerService {
  constructor(
    private readonly db: Db,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly paga: PagaClient,
    private readonly ai: AiService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  pricingRules() {
    const share = this.config.PLATFORM_SHARE_BPS;
    return {
      minimum_price: money(this.config.MINIMUM_PRICE_KOBO),
      platform_share_percent: share / 100,
      // What each Selar code costs the owner at the minimum price; scales with their own price.
      code_unit_share: money(Math.round((this.config.MINIMUM_PRICE_KOBO * share) / 10_000)),
      billing_periods: Object.keys(PERIOD_DAYS),
    };
  }

  async apply(userId: string, a: OwnerApplicationInput) {
    if (a.price.currency.toUpperCase() !== 'NGN') throw Problem.unprocessable('currency_not_supported', 'Prices are in naira (NGN)');
    if (a.price.amount_minor < this.config.MINIMUM_PRICE_KOBO) throw Problem.unprocessable('price_below_minimum', 'The price must be at least ₦5,000');
    const idHash = hmacHex(this.config.AUTH_PEPPER, `id:${a.id_type}:${a.id_number.replace(/\s+/g, '').toUpperCase()}`);
    const bankHash = a.bank_account_number && a.bank_code ? hmacHex(this.config.AUTH_PEPPER, `bank:${a.bank_code}:${a.bank_account_number.replace(/\D/g, '')}`) : null;

    const community = await this.db.asEngine(async (trx) => {
      const sameId = await trx.selectFrom('owner_profiles').select(['user_id', 'banned_at']).where((eb) => eb.or([eb('id_number_hash', '=', idHash), ...(bankHash ? [eb('bank_account_hash', '=', bankHash)] : [])])).execute();
      if (sameId.some((o) => o.banned_at)) throw Problem.conflict('owner_banned', 'This person cannot run a community on i-jobs');
      if (sameId.some((o) => o.user_id !== userId)) throw Problem.conflict('owner_identity_exists', 'This ID or bank account is already linked to another owner account');
      const mine = await trx.selectFrom('owner_profiles').select(['banned_at']).where('user_id', '=', userId).executeTakeFirst();
      if (mine?.banned_at) throw Problem.conflict('owner_banned', 'This person cannot run a community on i-jobs');
      if (await trx.selectFrom('communities').select('id').where('slug', '=', a.slug).executeTakeFirst()) throw Problem.conflict('slug_taken', 'That link name is taken. Try another.');

      await trx
        .insertInto('owner_profiles')
        .values({
          user_id: userId, legal_name: a.legal_name, id_type: a.id_type, id_number_hash: idHash, id_document_key: a.id_document_upload_id ?? null,
          bank_code: a.bank_code ?? null, bank_account_hash: bankHash, bank_account_last4: a.bank_account_number ? a.bank_account_number.replace(/\D/g, '').slice(-4) : null,
        })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ legal_name: a.legal_name, ...(bankHash ? { bank_code: a.bank_code, bank_account_hash: bankHash, bank_account_last4: a.bank_account_number!.replace(/\D/g, '').slice(-4) } : {}) }))
        .execute();
      let row: { id: string } | undefined;
      for (let i = 0; i < 5 && !row; i++) {
        row = await trx
          .insertInto('communities')
          .values({
            owner_user_id: userId, name: a.community_name, slug: a.slug, invite_code: inviteCode(a.community_name), description: a.description ?? null,
            proof_links: JSON.stringify(a.proof_links), price_kobo: a.price.amount_minor, billing_period: a.billing_period,
            platform_share_bps: this.config.PLATFORM_SHARE_BPS, trial_enabled: (a.trial_enabled ?? false) && this.sms.enabled, approval_required: a.approval_required ?? false,
          })
          .onConflict((oc) => oc.column('invite_code').doNothing())
          .returning('id')
          .executeTakeFirst();
      }
      if (!row) throw new Error('Could not create an invite code');
      await trx.insertInto('community_verifications').values({
        community_id: row.id, claimed_member_count: a.claimed_member_count ?? null, group_started_on: a.group_started_on ?? null,
        evidence: JSON.stringify([...a.proof_links, ...(a.evidence_upload_ids ?? [])]),
      }).execute();
      await trx.insertInto('moderation_items').values({ subject_type: 'community', subject_id: row.id, reason_internal: 'new community application' }).execute();
      return row;
    });
    return this.get(userId, community.id);
  }

  async list(userId: string) {
    const rows = await this.db.k.selectFrom('communities').select('id').where('owner_user_id', '=', userId).orderBy('created_at').execute();
    return Promise.all(rows.map((r) => this.get(userId, r.id)));
  }

  async get(userId: string, communityId: string) {
    const c = await this.owned(userId, communityId);
    const v = await this.db.k.selectFrom('community_verifications').select('decision').where('community_id', '=', communityId).orderBy('submitted_at', 'desc').executeTakeFirst();
    return {
      id: c.id, name: c.name, slug: c.slug, description: c.description, status: c.status, invite_code: c.invite_code,
      join_url: `${this.config.PUBLIC_APP_URL}/join/${c.slug}`,
      job_finds_url: `${this.config.PUBLIC_APP_URL}/job-finds?ref=${c.invite_code}`,
      price: money(c.price_kobo), billing_period: c.billing_period, platform_share_percent: c.platform_share_bps / 100,
      trial_enabled: c.trial_enabled && this.sms.enabled, approval_required: c.approval_required, demo_tours_left: 2 - c.demo_tours_used,
      strike_count: c.strike_count, verification: v?.decision ?? 'pending',
    };
  }

  async update(userId: string, communityId: string, u: { description?: string; trial_enabled?: boolean; approval_required?: boolean; price?: { amount_minor: number; currency: string }; billing_period?: string }) {
    await this.owned(userId, communityId);
    if (u.price && u.price.amount_minor < this.config.MINIMUM_PRICE_KOBO) throw Problem.unprocessable('price_below_minimum', 'The price must be at least ₦5,000');
    await this.db.asEngine((trx) =>
      trx
        .updateTable('communities')
        .set({
          ...(u.description !== undefined ? { description: u.description } : {}),
          ...(u.trial_enabled !== undefined ? { trial_enabled: u.trial_enabled && this.sms.enabled } : {}),
          ...(u.approval_required !== undefined ? { approval_required: u.approval_required } : {}),
          // New prices apply from each member's next period: renewals read the price when they're paid.
          ...(u.price ? { price_kobo: u.price.amount_minor } : {}),
          ...(u.billing_period ? { billing_period: u.billing_period as never } : {}),
        })
        .where('id', '=', communityId)
        .execute(),
    );
    return this.get(userId, communityId);
  }

  async funnel(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const [f, interviews] = await Promise.all([
      this.db.k.selectFrom('community_funnel').selectAll().where('community_id', '=', communityId).executeTakeFirstOrThrow(),
      this.db.asEngine((trx) =>
        trx.selectFrom('applications as a').innerJoin('memberships as m', 'm.user_id', 'a.user_id').select(sql<number>`count(DISTINCT a.id)::int`.as('n'))
          .where('m.community_id', '=', communityId).where('a.status', 'in', ['interview', 'offer', 'hired']).executeTakeFirstOrThrow()),
    ]);
    const n = (v: unknown) => Number(v ?? 0);
    return {
      invited: n(f.invited), joined: n(f.joined), awaiting_approval: n(f.awaiting_approval), not_paid_yet: n(f.not_paid_yet), on_trial: n(f.on_trial),
      paid: n(f.paid), stuck_no_cv: n(f.stuck_no_cv), stuck_no_rules: n(f.stuck_no_rules), fully_set_up: n(f.fully_set_up), interviews_landed: interviews.n,
    };
  }

  async members(userId: string, communityId: string, stage?: string) {
    await this.owned(userId, communityId);
    let q = this.db.k.selectFrom('owner_member_list').selectAll().where('community_id', '=', communityId);
    const live = ['active', 'trialing'] as never[];
    if (stage === 'awaiting_approval') q = q.where('status', '=', 'pending_approval');
    if (stage === 'not_paid_yet') q = q.where('status', '=', 'pending_payment');
    if (stage === 'on_trial') q = q.where('status', '=', 'trialing');
    if (stage === 'stuck_no_cv') q = q.where('status', 'in', live).where('onboarding_step', 'in', ['joined', 'paid']);
    if (stage === 'stuck_no_rules') q = q.where('status', 'in', live).where('onboarding_step', '=', 'cv_uploaded');
    if (stage === 'fully_set_up') q = q.where('onboarding_step', '=', 'complete');
    const rows = await q.orderBy('joined_at', 'desc').limit(1000).execute();
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return {
      items: rows.map((r) => ({
        membership_id: r.membership_id, first_name: r.first_name, status: r.status, onboarding_step: r.onboarding_step,
        joined_at: iso(r.joined_at), trial_ends_at: iso(r.trial_ends_at), current_period_end: iso(r.current_period_end),
        can_nudge: this.canNudge(r.status as string, r.onboarding_step as string, r.last_nudged_at),
      })),
      next_cursor: null,
    };
  }

  async approve(userId: string, communityId: string, membershipId: string) {
    await this.owned(userId, communityId);
    const r = await this.db.asEngine((trx) =>
      trx.updateTable('memberships').set({ status: 'pending_payment', approved_at: sql`now()`, approved_by: userId }).where('id', '=', membershipId).where('community_id', '=', communityId).where('status', '=', 'pending_approval').returning('user_id').executeTakeFirst(),
    );
    if (!r) throw Problem.notFound('membership_not_found', 'No join request here');
    await this.notify(r.user_id, 'membership.approved', 'You were let in', 'Your community approved you. Pay or start your trial to begin.');
    return { membership_id: membershipId, status: 'pending_payment' };
  }

  async decline(userId: string, communityId: string, membershipId: string) {
    await this.owned(userId, communityId);
    const r = await this.db.asEngine((trx) =>
      trx.updateTable('memberships').set({ status: 'cancelled', cancelled_at: sql`now()` }).where('id', '=', membershipId).where('community_id', '=', communityId).where('status', '=', 'pending_approval').executeTakeFirst(),
    );
    if (!Number(r.numUpdatedRows)) throw Problem.notFound('membership_not_found', 'No join request here');
  }

  /** i-jobs sends the reminder; the owner never sees how to reach the member. */
  async nudge(userId: string, communityId: string, membershipId: string) {
    const c = await this.owned(userId, communityId);
    const m = await this.db.asEngine((trx) =>
      trx.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['m.status', 'm.onboarding_step', 'm.last_nudged_at', 'u.email', 'u.phone', 'u.full_name'])
        .where('m.id', '=', membershipId).where('m.community_id', '=', communityId).executeTakeFirst(),
    );
    if (!m) throw Problem.notFound('membership_not_found', 'No member here');
    if (!this.canNudge(m.status, m.onboarding_step, m.last_nudged_at)) {
      throw Problem.tooMany(m.last_nudged_at ? Math.max(60, (new Date(m.last_nudged_at as unknown as string).getTime() + NUDGE_EVERY_DAYS * 86400_000 - Date.now()) / 1000) : 3600, 'You can remind each member once every 3 days');
    }
    const next = m.status === 'pending_payment' ? 'finish joining' : m.onboarding_step === 'joined' || m.onboarding_step === 'paid' ? 'upload your CV' : 'set your autopilot rules';
    const text = `${c.name} is waiting for you on i-jobs. Next step: ${next}. ${this.config.PUBLIC_APP_URL}`;
    if (m.email) await this.mail.send({ to: m.email, subject: `${c.name}: one step left`, text: `Hi ${m.full_name?.split(' ')[0] ?? 'there'},\n\n${text}` });
    else if (m.phone && this.sms.enabled) await this.sms.send({ to: m.phone, text });
    else throw Problem.conflict('cannot_reach_member', 'This member can’t be reached right now');
    await this.db.asEngine((trx) => trx.updateTable('memberships').set({ last_nudged_at: sql`now()` }).where('id', '=', membershipId).execute());
  }

  // ---------------------------------------------------------------- invites

  async invites(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const rows = await this.db.k.selectFrom('community_invites').selectAll().where('community_id', '=', communityId).orderBy('created_at', 'desc').limit(1000).execute();
    return {
      items: rows.map((i) => ({ id: i.id, target_masked: maskTarget(i.target), channel: i.channel, status: i.status, sent_at: i.sent_at ? new Date(i.sent_at as unknown as string).toISOString() : null })),
      next_cursor: null,
    };
  }

  async sendInvites(userId: string, communityId: string, targets: string[]) {
    const c = await this.owned(userId, communityId);
    if (c.status !== 'active') throw Problem.conflict('community_not_active', 'Invites open once your community is verified');
    const invalid: string[] = [];
    const clean = new Map<string, 'email' | 'phone'>();
    for (const raw of targets) {
      const t = raw.trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(t)) clean.set(t, 'email');
      else if (this.sms.enabled && /^\+[1-9]\d{6,14}$/.test(t.replace(/[\s-]/g, ''))) clean.set(t.replace(/[\s-]/g, ''), 'phone');
      else invalid.push(raw);
    }
    const inserted = clean.size
      ? await this.db.asEngine((trx) =>
          trx.insertInto('community_invites').values([...clean].map(([target, channel]) => ({ community_id: communityId, target, channel }))).onConflict((oc) => oc.doNothing()).returning('id').execute(),
        )
      : [];
    if (inserted.length) await this.queues.add(QUEUES.mail, 'invites', { communityId }, { jobId: `invites-${communityId}-${Date.now()}` });
    return { queued: inserted.length, skipped_duplicates: clean.size - inserted.length, invalid };
  }

  /** Worker: send pending invites for one community. */
  async deliverInvites(communityId: string) {
    const c = await this.db.k.selectFrom('communities').select(['name', 'slug', 'status']).where('id', '=', communityId).executeTakeFirstOrThrow();
    if (c.status !== 'active') return { sent: 0 };
    const pending = await this.db.k.selectFrom('community_invites').select(['id', 'target', 'channel']).where('community_id', '=', communityId).where('status', '=', 'pending').limit(500).execute();
    for (const i of pending) {
      const link = `${this.config.PUBLIC_APP_URL}/join/${c.slug}`;
      if (i.channel === 'email') await this.mail.send({ to: i.target, subject: `You're invited to ${c.name} on i-jobs`, text: `${c.name} invited you to i-jobs, where AI finds jobs for you and applies on your behalf.\n\nJoin here: ${link}` });
      else if (this.sms.enabled) await this.sms.send({ to: i.target, text: `${c.name} invited you to i-jobs. Join: ${link}` });
      else continue; // texts were turned off after this invite was queued: leave it pending
      await this.db.asEngine((trx) => trx.updateTable('community_invites').set({ status: 'sent', sent_at: sql`now()` }).where('id', '=', i.id).execute());
    }
    return { sent: pending.length };
  }

  // ---------------------------------------------------------------- demo tours, strikes, earnings

  async demoTour(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const r = await this.db.asEngine((trx) =>
      trx.updateTable('communities').set({ demo_tours_used: sql`demo_tours_used + 1` }).where('id', '=', communityId).where('demo_tours_used', '<', 2).returning('demo_tours_used').executeTakeFirst(),
    );
    if (!r) throw Problem.conflict('demo_tours_used_up', 'Both demo tours have been used');
    const token = randomToken(16);
    // Sample profiles and jobs only; the web app shows them read-only. Nothing is ever sent.
    await this.redis.client.set(`demo:${token}`, JSON.stringify({ communityId }), 'EX', 86400);
    return { demo_url: `${this.config.PUBLIC_APP_URL}/demo/${token}`, tours_left: 2 - r.demo_tours_used };
  }

  async strikes(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('community_strikes').select(['id', 'reason', 'appeal_text', 'appeal_decision', 'created_at']).where('community_id', '=', communityId).orderBy('created_at', 'desc').execute(),
    );
    return rows.map((r) => ({
      id: r.id, reason: r.reason, created_at: new Date(r.created_at as unknown as string).toISOString(),
      appeal: r.appeal_text ? (r.appeal_decision ?? 'pending') : null, can_appeal: !r.appeal_text,
    }));
  }

  /** The tour link the owner shares: sample data only, valid for a day. */
  async demo(token: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw Problem.notFound('demo_not_found', 'This demo link has ended');
    const raw = await this.redis.client.get(`demo:${token}`);
    if (!raw) throw Problem.notFound('demo_not_found', 'This demo link has ended');
    const { communityId } = JSON.parse(raw) as { communityId: string };
    const [c, ttl] = await Promise.all([
      this.db.k.selectFrom('communities').select(['name', 'slug', 'status']).where('id', '=', communityId).executeTakeFirst(),
      this.redis.client.ttl(`demo:${token}`),
    ]);
    if (!c || c.status === 'banned') throw Problem.notFound('demo_not_found', 'This demo link has ended');
    return { community: { name: c.name, slug: c.slug }, expires_at: new Date(Date.now() + Math.max(0, ttl) * 1000).toISOString() };
  }

  async appealStrike(userId: string, communityId: string, strikeId: string, reason: string) {
    await this.owned(userId, communityId);
    const r = await this.db.asEngine((trx) =>
      trx.updateTable('community_strikes').set({ appeal_text: reason, appeal_decision: 'pending' }).where('id', '=', strikeId).where('community_id', '=', communityId).where('appeal_text', 'is', null).returning('id').executeTakeFirst(),
    );
    if (!r) throw Problem.notFound('strike_not_found', 'No open strike here');
    await this.db.asEngine((trx) => trx.insertInto('moderation_items').values({ subject_type: 'community', subject_id: communityId, reason_internal: `strike appeal ${strikeId}` }).execute());
  }

  async earnings(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const [balance, payouts, recent] = await Promise.all([
      this.db.asEngine((trx) => trx.selectFrom('owner_balances').select('balance_kobo').where('community_id', '=', communityId).executeTakeFirst()),
      this.db.asEngine((trx) => trx.selectFrom('payouts').selectAll().where('community_id', '=', communityId).orderBy('created_at', 'desc').limit(24).execute()),
      this.db.asEngine((trx) =>
        trx.selectFrom('ledger_entries').select(sql<string>`coalesce(-sum(amount_kobo), 0)`.as('kobo')).where('community_id', '=', communityId).where('account', '=', 'owner_payable')
          .where('amount_kobo', '<', '0').where('created_at', '>', sql<Date>`now() - make_interval(days => ${this.config.PAYOUT_HOLD_DAYS})`).executeTakeFirstOrThrow()),
    ]);
    const pendingPayouts = payouts.filter((p) => ['held', 'ready', 'processing', 'frozen'].includes(p.status)).reduce((s, p) => s + Number(p.amount_kobo), 0);
    const now = new Date();
    return {
      balance: money(Number(balance?.balance_kobo ?? 0) - pendingPayouts),
      on_hold: money(Number(recent.kobo) + pendingPayouts),
      next_payout_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 8)).toISOString(),
      payouts: payouts.map((p) => ({
        id: p.id, amount: money(p.amount_kobo), status: p.status, hold_until: new Date(p.hold_until as unknown as string).toISOString(),
        paid_at: p.paid_at ? new Date(p.paid_at as unknown as string).toISOString() : null, frozen_reason: p.frozen_reason,
      })),
    };
  }

  // ---------------------------------------------------------------- Selar code batches

  async buyCodes(userId: string, communityId: string, quantity: number) {
    const c = await this.owned(userId, communityId);
    if (c.status !== 'active') throw Problem.conflict('community_not_active', 'Codes are available once your community is verified');
    const unit = Math.round((Number(c.price_kobo) * c.platform_share_bps) / 10_000);
    const owner = await this.db.k.selectFrom('users').select(['email', 'phone', 'full_name']).where('id', '=', userId).executeTakeFirstOrThrow();
    const { batch, payment } = await this.db.asEngine(async (trx) => {
      const batch = await trx.insertInto('code_batches').values({ community_id: communityId, quantity, unit_share_kobo: unit, grants_period: c.billing_period, terms_accepted_at: sql`now()`, created_by: userId }).returning(['id', 'total_kobo']).executeTakeFirstOrThrow();
      const payment = await trx.insertInto('payments').values({ user_id: userId, community_id: communityId, code_batch_id: batch.id, purpose: 'code_batch', amount_kobo: batch.total_kobo! }).returning(['id', 'amount_kobo']).executeTakeFirstOrThrow();
      return { batch, payment };
    });
    const checkout = await this.startPayment(payment.id, Number(payment.amount_kobo), { name: owner.full_name ?? 'Community owner', email: owner.email, phone: owner.phone }, `${quantity} access codes for ${c.name}`);
    return { batch: await this.batchView(batch.id), checkout };
  }

  async batches(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const rows = await this.db.k.selectFrom('code_batches').select('id').where('community_id', '=', communityId).orderBy('created_at', 'desc').execute();
    return Promise.all(rows.map((r) => this.batchView(r.id)));
  }

  async codesCsv(userId: string, batchId: string): Promise<string> {
    const b = await this.db.k.selectFrom('code_batches').select(['community_id', 'payment_id']).where('id', '=', batchId).executeTakeFirst();
    if (!b) throw Problem.notFound('batch_not_found', 'There is no batch here');
    await this.owned(userId, b.community_id);
    if (!b.payment_id) throw new Problem(402, 'batch_unpaid', 'This batch has not been paid for yet');
    const codes = await this.db.asEngine((trx) => trx.selectFrom('access_codes').select(['code', 'status']).where('batch_id', '=', batchId).orderBy('created_at').execute());
    return ['code,status', ...codes.map((c) => `${c.code},${c.status}`)].join('\n') + '\n';
  }

  // ---------------------------------------------------------------- pasted jobs

  async pasteJob(userId: string, communityId: string, text: string) {
    const c = await this.owned(userId, communityId);
    if (c.status !== 'active') throw Problem.conflict('community_not_active', 'Posting jobs opens once your community is verified');
    const raw = await this.db.asEngine((trx) =>
      trx.insertInto('raw_postings').values({ source_key: 'community_paste', external_id: `paste-${randomToken(12)}`, payload: JSON.stringify({ text, community_id: communityId, owner_user_id: userId }), content_hash: hmacHex('paste', text), status: 'new' })
        .returning('id').executeTakeFirstOrThrow(),
    );
    const budget = await this.db.k.selectFrom('ai_budget_today').select('remaining_tokens').where('task', '=', 'job_extract').executeTakeFirst();
    const wait = !this.ai.enabled || Number(budget?.remaining_tokens ?? 0) < 1500;
    const at = wait ? nextUtcMidnight() : null;
    await this.db.asEngine((trx) => trx.updateTable('raw_postings').set({ process_after: at ?? sql`now()`, last_error: wait ? 'ai_budget' : null }).where('id', '=', raw.id).execute());
    return { work_id: raw.id, kind: 'job_paste', status: wait ? 'scheduled' : 'queued', scheduled_for: at?.toISOString() ?? null, reason: wait ? 'daily_ai_budget' : null };
  }

  async communityJobs(userId: string, communityId: string) {
    await this.owned(userId, communityId);
    const [reading, jobs] = await Promise.all([
      this.db.asEngine((trx) => trx.selectFrom('raw_postings').select(['id', 'first_seen_at']).where('source_key', '=', 'community_paste').where('status', '=', 'new').where(sql<boolean>`payload->>'community_id' = ${communityId}`).execute()),
      this.db.k.selectFrom('jobs').select(['id', 'title', 'company_name', 'status', 'owner_confirmed_at', 'expires_at', 'first_seen_at', 'description', 'apply_url', 'apply_email']).where('community_id', '=', communityId).orderBy('first_seen_at', 'desc').limit(200).execute(),
    ]);
    return {
      items: [
        ...reading.map((r) => ({ job: { id: r.id }, state: 'reading', expires_at: null, can_renew: false })),
        ...jobs.map((j) => this.communityJobView(j)),
      ],
      next_cursor: null,
    };
  }

  async confirmJob(userId: string, communityId: string, jobId: string, fix: { title?: string; company_name?: string; description?: string; apply_url?: string | null; apply_email?: string | null }) {
    await this.owned(userId, communityId);
    const job = await this.db.k.selectFrom('jobs').select(['id', 'status', 'owner_confirmed_at']).where('id', '=', jobId).where('community_id', '=', communityId).executeTakeFirst();
    if (!job) throw Problem.notFound('job_not_found', 'There is no job here');
    const flagged = !!(await this.db.asEngine((trx) => trx.selectFrom('moderation_items').select('id').where('subject_type', '=', 'job').where('subject_id', '=', jobId).where('status', 'in', ['open', 'in_review', 'escalated']).executeTakeFirst()));
    const row = await this.db.asEngine((trx) =>
      trx.updateTable('jobs').set({
        ...fix, ...(fix.apply_email ? { apply_method: 'email' as const } : fix.apply_url ? { apply_method: 'external_link' as const } : {}),
        owner_confirmed_at: sql`now()`,
        // Flagged posts show "under review" and never say why.
        status: job.status === 'scam' ? 'scam' : flagged ? 'pending_review' : 'live',
      }).where('id', '=', jobId).returningAll().executeTakeFirstOrThrow(),
    );
    return this.communityJobView(row);
  }

  async renewJob(userId: string, communityId: string, jobId: string) {
    await this.owned(userId, communityId);
    const r = await this.db.asEngine((trx) =>
      trx.updateTable('jobs').set({ expires_at: sql`least(now() + make_interval(days => ${PASTED_JOB_DAYS}), first_seen_at + interval '60 days' - interval '1 minute')`, status: sql`CASE WHEN status = 'expired' THEN 'live'::job_status ELSE status END` })
        .where('id', '=', jobId).where('community_id', '=', communityId).where('status', 'in', ['live', 'expired']).where(sql<boolean>`first_seen_at > now() - interval '59 days'`).returningAll().executeTakeFirst(),
    );
    if (!r) throw Problem.conflict('cannot_renew', 'This job is too old to renew (60 days at most)');
    return this.communityJobView(r);
  }

  // ---------------------------------------------------------------- helpers

  async startPayment(paymentId: string, amountKobo: number, payer: { name: string; email: string | null; phone: string | null }, description: string) {
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    const link = await this.paga.requestPayment({
      reference: paymentId, amountKobo, payer, description, expiresAt,
      callbackUrl: `${this.config.PUBLIC_API_URL}/v1/hooks/paga`, redirectUrl: `${this.config.PUBLIC_APP_URL}/payments/${paymentId}`,
    });
    await this.db.asEngine((trx) => trx.updateTable('payments').set({ provider_ref: link.providerRef, checkout_url: link.checkoutUrl, expires_at: expiresAt }).where('id', '=', paymentId).execute());
    return { payment_id: paymentId, provider: 'paga', reference: link.providerRef, checkout_url: link.checkoutUrl, amount: money(amountKobo), expires_at: expiresAt.toISOString() };
  }

  private async owned(userId: string, communityId: string) {
    const c = await this.db.k.selectFrom('communities').selectAll().where('id', '=', communityId).where('owner_user_id', '=', userId).executeTakeFirst();
    if (!c) throw Problem.notFound('community_not_found', 'There is no community of yours here');
    return c;
  }

  private canNudge(status: string, step: string, last: unknown) {
    return ['pending_payment', 'trialing', 'active'].includes(status) && step !== 'complete' && (!last || Date.now() - new Date(last as string).getTime() > NUDGE_EVERY_DAYS * 86400_000);
  }

  private async batchView(batchId: string) {
    const b = await this.db.k.selectFrom('code_batches').selectAll().where('id', '=', batchId).executeTakeFirstOrThrow();
    const counts = await this.db.asEngine((trx) => trx.selectFrom('access_codes').select(['status', sql<number>`count(*)::int`.as('n')]).where('batch_id', '=', batchId).groupBy('status').execute());
    const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
    return {
      id: b.id, quantity: b.quantity, unit_share: money(b.unit_share_kobo), total: money(b.total_kobo), grants_period: b.grants_period, paid: !!b.payment_id,
      unused: n('unused'), redeemed: n('redeemed'), void: n('void'), created_at: new Date(b.created_at as unknown as string).toISOString(),
    };
  }

  private communityJobView(j: any) {
    const state = j.status === 'live' && j.owner_confirmed_at ? 'live'
      : !j.owner_confirmed_at && ['live', 'pending_review'].includes(j.status) ? 'needs_confirmation'
      : j.status === 'pending_review' || j.status === 'scam' ? 'under_review'
      : j.status === 'expired' ? 'expired' : 'removed';
    return {
      job: { id: j.id, title: j.title, company_name: j.company_name, description: j.description, apply_url: j.apply_url, apply_email: j.apply_email },
      state, expires_at: new Date(j.expires_at).toISOString(),
      can_renew: ['live', 'expired'].includes(j.status) && Date.now() - new Date(j.first_seen_at).getTime() < 59 * 86400_000,
    };
  }

  private notify(userId: string, type: string, title: string, body: string) {
    return this.db.asEngine(async (trx) => {
      const site = await trx.selectFrom('sites').select('id').where('slug', '=', this.config.IJOBS_SITE_SLUG).executeTakeFirstOrThrow();
      await trx.insertInto('notifications').values({ user_id: userId, site_id: site.id, type, title, body }).execute();
    });
  }
}

export { PASTED_JOB_DAYS };

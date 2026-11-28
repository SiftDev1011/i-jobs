import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AuthService } from '../auth/auth.service';
import { hmacHex } from '../common/crypto';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { SmsService } from '../messaging/sms.service';
import { recordCodeBatchPayment, recordMembershipPayment } from '../money/ledger';
import { PagaCallback, PagaClient } from '../money/paga';
import { OwnerService } from './owner.service';
import { accessCode, addDays, money, PERIOD_DAYS } from './shared';

type Via = 'invite_link' | 'invite_code' | 'bulk_invite' | 'job_finds_page';

/** Members joining, trials, paying, and the membership lifecycle. */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger('Memberships');

  constructor(
    private readonly db: Db,
    private readonly owners: OwnerService,
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly sms: SmsService,
  ) {}

  /** Where a payment stands, for the page Paga sends the payer back to. Only the payer can see it. */
  async payment(userId: string, paymentId: string) {
    const p = await this.db.asEngine((trx) =>
      trx.selectFrom('payments as p').leftJoin('communities as c', 'c.id', 'p.community_id')
        .select(['p.id', 'p.purpose', 'p.status', 'p.amount_kobo', 'p.membership_id', 'p.code_batch_id', 'p.community_id', 'p.paid_at', 'p.failure_reason', 'c.name as community_name'])
        .where('p.id', '=', paymentId).where('p.user_id', '=', userId).executeTakeFirst(),
    );
    if (!p) throw Problem.notFound('payment_not_found', 'There is no payment of yours here');
    return {
      id: p.id, purpose: p.purpose, status: p.status, amount: money(p.amount_kobo),
      community: p.community_id ? { id: p.community_id, name: p.community_name } : null,
      membership_id: p.membership_id, code_batch_id: p.code_batch_id,
      paid_at: p.paid_at ? new Date(p.paid_at as unknown as string).toISOString() : null,
      failed: p.status === 'failed' ? (p.failure_reason ?? 'The payment did not go through') : null,
    };
  }

  // ---------------------------------------------------------------- finding and joining

  async search(q: string | undefined, limit: number) {
    let query = this.db.k
      .selectFrom('communities as c')
      .leftJoin('community_funnel as f', 'f.community_id', 'c.id')
      .select(['c.id', 'c.name', 'c.slug', 'c.verified_at', sql<number>`coalesce(f.paid, 0) + coalesce(f.on_trial, 0)`.as('members')])
      .where('c.status', '=', 'active');
    if (q?.trim()) query = query.where((eb) => eb.or([eb('c.name', 'ilike', `%${q.trim()}%`), eb('c.description', 'ilike', `%${q.trim()}%`), sql<boolean>`c.name % ${q.trim()}`]));
    const rows = await query.orderBy('members', 'desc').limit(limit).execute();
    // No prices here; they show on the join page.
    return { items: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, member_count: Number(r.members), verified: !!r.verified_at })), next_cursor: null };
  }

  async joinPage(code: string) {
    const c = await this.communityByCode(code);
    if (c) {
      return {
        kind: 'community_invite', community: await this.publicCommunity(c),
        price: money(c.price_kobo), billing_period: c.billing_period, trial_available: c.trial_enabled && this.sms.enabled, approval_required: c.approval_required,
      };
    }
    const ac = await this.accessCode(code);
    return {
      kind: 'access_code', community: await this.publicCommunity(ac.community),
      price: null, billing_period: ac.community.billing_period, trial_available: false, approval_required: false,
    };
  }

  async join(userId: string, code: string, via: Via | undefined) {
    await this.assertAdult(userId);
    const c = await this.communityByCode(code);
    if (!c) return this.redeem(userId, code);

    const existing = await this.db.k.selectFrom('memberships').select(['id', 'status']).where('user_id', '=', userId).where('community_id', '=', c.id).executeTakeFirst();
    if (existing && !['expired', 'cancelled'].includes(existing.status)) throw Problem.conflict('already_member', 'You are already in this community');
    const status = c.approval_required ? 'pending_approval' : 'pending_payment';
    const invite = await this.matchingInvite(userId, c.id);
    const source = (await this.wasInBannedCommunity(userId)) ? 'switched' : invite ? 'bulk_invite' : (via ?? (code.toLowerCase() === c.slug.toLowerCase() ? 'invite_link' : 'invite_code'));
    const id = await this.db.asEngine(async (trx) => {
      const row = existing
        ? await trx.updateTable('memberships').set({ status, source, cancelled_at: null, approved_at: null }).where('id', '=', existing.id).returning('id').executeTakeFirstOrThrow()
        : await trx.insertInto('memberships').values({ user_id: userId, community_id: c.id, status, source, invite_id: invite?.id ?? null }).returning('id').executeTakeFirstOrThrow();
      if (invite) await trx.updateTable('community_invites').set({ status: 'joined', joined_user_id: userId }).where('id', '=', invite.id).execute();
      // Credited to the first community that brought them, for good (a trigger keeps it).
      await trx.updateTable('users').set({ referred_by_community_id: c.id }).where('id', '=', userId).where('referred_by_community_id', 'is', null).execute();
      return row.id;
    });
    return this.view(userId, id);
  }

  async requestToJoin(userId: string, communityId: string) {
    await this.assertAdult(userId);
    const c = await this.db.k.selectFrom('communities').select(['id', 'status']).where('id', '=', communityId).executeTakeFirst();
    if (!c || c.status !== 'active') throw Problem.notFound('community_not_found', 'There is no community here');
    const existing = await this.db.k.selectFrom('memberships').select(['id', 'status']).where('user_id', '=', userId).where('community_id', '=', communityId).executeTakeFirst();
    if (existing && !['expired', 'cancelled'].includes(existing.status)) throw Problem.conflict('already_member', 'You are already in this community');
    const row = await this.db.asEngine((trx) =>
      existing
        ? trx.updateTable('memberships').set({ status: 'pending_approval', source: 'search' as never, cancelled_at: null }).where('id', '=', existing.id).returning('id').executeTakeFirstOrThrow()
        : trx.insertInto('memberships').values({ user_id: userId, community_id: communityId, status: 'pending_approval', source: 'search' as never }).returning('id').executeTakeFirstOrThrow(),
    );
    return this.view(userId, row.id);
  }

  async mine(userId: string) {
    const rows = await this.db.k.selectFrom('memberships').select('id').where('user_id', '=', userId).orderBy('created_at', 'desc').execute();
    return Promise.all(rows.map((r) => this.view(userId, r.id)));
  }

  // ---------------------------------------------------------------- trial and payment

  async startTrial(userId: string, membershipId: string, phoneCode: string, cardToken?: string) {
    const m = await this.own(userId, membershipId);
    if (!this.sms.enabled) throw Problem.conflict('trials_off', 'Free weeks aren’t available right now');
    if (!m.trial_enabled) throw Problem.conflict('trial_not_offered', 'This community does not offer a free trial');
    if (m.status === 'pending_approval') throw Problem.forbidden('awaiting_approval', 'Waiting for the community to let you in');
    if (m.status !== 'pending_payment') throw Problem.conflict('trial_not_available', 'A trial is only for new members who have not paid');
    const user = await this.db.k.selectFrom('users').select(['phone']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (!user.phone) throw Problem.unprocessable('phone_required', 'Add your phone number first; trials are tied to one number');
    await this.auth.verifyCode(user.phone, phoneCode);

    const phoneHash = hmacHex(this.config.AUTH_PEPPER, `trial-phone:${user.phone}`);
    const cardHash = cardToken ? hmacHex(this.config.AUTH_PEPPER, `trial-card:${cardToken}`) : null;
    await this.db.asEngine(async (trx) => {
      const used = await trx.selectFrom('trial_claims').select(['user_id']).where((eb) => eb.or([eb('user_id', '=', userId), eb('phone_hash', '=', phoneHash), ...(cardHash ? [eb('card_fingerprint', '=', cardHash)] : [])])).execute();
      if (used.length) {
        if (used.some((u) => u.user_id !== userId)) {
          await trx.insertInto('fraud_signals').values({ kind: 'trial_abuse', community_id: m.community_id, user_id: userId, details: JSON.stringify({ shared_with: used.map((u) => u.user_id) }) }).execute();
        }
        throw Problem.conflict('trial_already_used', 'You have already had a free trial');
      }
      const ends = addDays(new Date(), this.config.TRIAL_DAYS);
      await trx.updateTable('users').set({ phone_verified_at: sql`coalesce(phone_verified_at, now())` }).where('id', '=', userId).execute();
      await trx.updateTable('memberships').set({ status: 'trialing', trial_started_at: sql`now()`, trial_ends_at: ends }).where('id', '=', membershipId).execute();
      await trx.insertInto('trial_claims').values({ user_id: userId, membership_id: membershipId, phone_hash: phoneHash, card_fingerprint: cardHash }).execute();
    });
    return this.view(userId, membershipId);
  }

  async checkout(userId: string, membershipId: string) {
    const m = await this.own(userId, membershipId);
    if (m.status === 'pending_approval') throw Problem.forbidden('awaiting_approval', 'Waiting for the community to let you in');
    if (m.community_status !== 'active') throw Problem.conflict('community_not_active', 'This community is not taking payments');
    if (m.status === 'cancelled') throw Problem.conflict('membership_cancelled', 'Join again to pay');
    this.owners.assertPaymentsOn();
    const user = await this.db.k.selectFrom('users').select(['email', 'phone', 'full_name']).where('id', '=', userId).executeTakeFirstOrThrow();
    const payment = await this.db.asEngine((trx) =>
      trx.insertInto('payments').values({ user_id: userId, community_id: m.community_id, membership_id: membershipId, purpose: 'membership', amount_kobo: m.price_kobo }).returning(['id', 'amount_kobo']).executeTakeFirstOrThrow(),
    );
    try {
      return await this.owners.startPayment(payment.id, Number(payment.amount_kobo), { name: user.full_name ?? 'i-jobs member', email: user.email, phone: user.phone }, `${m.community_name} membership`);
    } catch (e) {
      await this.db.asEngine((trx) => trx.updateTable('payments').set({ status: 'failed', failure_reason: 'Paga did not accept the payment request' }).where('id', '=', payment.id).where('status', '=', 'pending').execute());
      throw e;
    }
  }

  /** Paga's callback. Idempotent: only a pending payment can succeed, once. */
  async onPagaCallback(c: PagaCallback): Promise<'paid' | 'failed' | 'ignored'> {
    const payment = await this.db.asEngine((trx) => trx.selectFrom('payments').selectAll().where('provider_ref', '=', c.externalReferenceNumber).executeTakeFirst());
    if (!payment) {
      this.logger.warn(`Paga callback for unknown reference ${c.externalReferenceNumber}`);
      return 'ignored';
    }
    if (!PagaClient.isPaid(c)) {
      await this.db.asEngine((trx) => trx.updateTable('payments').set({ status: 'failed', failure_reason: String(c.statusMessage ?? c.statusCode).slice(0, 200), raw: JSON.stringify(c) }).where('id', '=', payment.id).where('status', '=', 'pending').execute());
      return 'failed';
    }
    const paidKobo = Math.round(Number(c.paymentAmount ?? 0) * 100);
    const feeKobo = c.collectionFee ? Math.round(Number(c.collectionFee) * 100) : 0;
    return this.db.asEngine(async (trx) => {
      const p = await trx.updateTable('payments').set({ status: 'succeeded', paid_at: sql`now()`, raw: JSON.stringify(c) }).where('id', '=', payment.id).where('status', '=', 'pending').returningAll().executeTakeFirst();
      if (!p) return 'ignored'; // already handled
      if (paidKobo && paidKobo < Number(p.amount_kobo)) {
        await trx.insertInto('fraud_signals').values({ kind: 'other', community_id: p.community_id, user_id: p.user_id, details: JSON.stringify({ underpaid: { expected: Number(p.amount_kobo), got: paidKobo, payment: p.id } }) }).execute();
      }
      if (p.purpose === 'membership') {
        const m = await trx.selectFrom('memberships as m').innerJoin('communities as c', 'c.id', 'm.community_id').select(['m.id', 'm.status', 'm.current_period_end', 'm.trial_ends_at', 'm.onboarding_step', 'c.billing_period', 'c.platform_share_bps'])
          .where('m.id', '=', p.membership_id!).executeTakeFirstOrThrow();
        await recordMembershipPayment(trx, { paymentId: p.id, communityId: p.community_id!, amountKobo: Number(p.amount_kobo), shareBps: m.platform_share_bps, feeKobo });
        // Paying early never loses days: the new period starts when the current one (or the trial) ends.
        const now = Date.now();
        const from = Math.max(now, m.current_period_end ? new Date(m.current_period_end as unknown as string).getTime() : 0, m.status === 'trialing' && m.trial_ends_at ? new Date(m.trial_ends_at as unknown as string).getTime() : 0);
        await trx.updateTable('memberships').set({
          status: 'active', current_period_start: m.status === 'active' ? sql`current_period_start` : new Date(now), current_period_end: addDays(new Date(from), PERIOD_DAYS[m.billing_period]),
          onboarding_step: m.onboarding_step === 'joined' ? 'paid' : m.onboarding_step, reminded_for: null,
        }).where('id', '=', m.id).execute();
      } else {
        await recordCodeBatchPayment(trx, { paymentId: p.id, amountKobo: Number(p.amount_kobo), feeKobo });
        const batch = await trx.updateTable('code_batches').set({ payment_id: p.id }).where('id', '=', p.code_batch_id!).returning(['id', 'quantity', 'community_id']).executeTakeFirstOrThrow();
        const c2 = await trx.selectFrom('communities').select('name').where('id', '=', batch.community_id).executeTakeFirstOrThrow();
        const codes = new Set<string>();
        while (codes.size < batch.quantity) codes.add(accessCode(c2.name));
        for (const chunk of chunks([...codes], 1000)) {
          await trx.insertInto('access_codes').values(chunk.map((code) => ({ code, batch_id: batch.id, community_id: batch.community_id }))).execute();
        }
      }
      return 'paid';
    });
  }

  // ---------------------------------------------------------------- lifecycle (worker, hourly)

  async lifecycle(): Promise<Record<string, number>> {
    const out = await this.db.asEngine(async (trx) => {
      const trialsOver = await trx.updateTable('memberships').set({ status: 'expired' }).where('status', '=', 'trialing').where('trial_ends_at', '<', sql<Date>`now()`).executeTakeFirst();
      const lapsed = await trx.updateTable('memberships').set({ status: 'past_due' }).where('status', '=', 'active').where('current_period_end', '<', sql<Date>`now()`).executeTakeFirst();
      // Grace days, then access ends. Members of banned communities just run to the end of what they paid.
      const ended = await trx.updateTable('memberships').set({ status: 'expired' }).where('status', '=', 'past_due')
        .where(sql<boolean>`current_period_end < now() - make_interval(days => ${this.config.GRACE_DAYS}) OR community_id IN (SELECT id FROM communities WHERE status = 'banned')`).executeTakeFirst();
      const ending = await trx.selectFrom('memberships as m').innerJoin('communities as c', 'c.id', 'm.community_id')
        .select(['m.id', 'm.user_id', 'm.status', 'm.trial_ends_at', 'm.current_period_end', 'c.name', 'c.status as community_status'])
        .where((eb) => eb.or([
          eb.and([eb('m.status', '=', 'trialing'), eb('m.trial_ends_at', '<', sql<Date>`now() + interval '1 day'`)]),
          eb.and([eb('m.status', '=', 'active'), eb('m.current_period_end', '<', sql<Date>`now() + interval '3 days'`)]),
        ]))
        .where((eb) => eb.or([eb('m.reminded_for', 'is', null), eb('m.reminded_for', '<>', sql<Date>`coalesce(m.trial_ends_at, m.current_period_end)`)]))
        .execute();
      const site = await trx.selectFrom('sites').select('id').where('slug', '=', this.config.IJOBS_SITE_SLUG).executeTakeFirstOrThrow();
      for (const m of ending) {
        const banned = m.community_status === 'banned';
        await trx.insertInto('notifications').values({
          user_id: m.user_id, site_id: site.id, type: banned ? 'membership.switch_offer' : 'membership.ending',
          title: banned ? `${m.name} is no longer on i-jobs` : m.status === 'trialing' ? 'Your free trial ends tomorrow' : 'Your membership renews soon',
          body: banned ? 'Your access lasts until the end of what you paid for. Pick another community to keep your matches and autopilot.' : `Pay to keep your matches and autopilot running with ${m.name}.`,
          data: JSON.stringify({ membership_id: m.id }),
        }).execute();
        await trx.updateTable('memberships').set({ reminded_for: sql`coalesce(trial_ends_at, current_period_end)` }).where('id', '=', m.id).execute();
      }
      return { trials_ended: Number(trialsOver.numUpdatedRows), lapsed: Number(lapsed.numUpdatedRows), ended: Number(ended.numUpdatedRows), reminded: ending.length };
    });
    // Payment links nobody used.
    await this.db.asEngine((trx) => trx.updateTable('payments').set({ status: 'failed', failure_reason: 'expired' }).where('status', '=', 'pending').where('created_at', '<', sql<Date>`now() - interval '7 days'`).execute());
    return out;
  }

  // ---------------------------------------------------------------- helpers

  async view(userId: string, membershipId: string) {
    const m = await this.db.k.selectFrom('memberships as m').innerJoin('communities as c', 'c.id', 'm.community_id')
      .select(['m.id', 'm.status', 'm.source', 'm.onboarding_step', 'm.trial_ends_at', 'm.current_period_end', 'c.id as community_id', 'c.name', 'c.slug', 'c.status as community_status'])
      .where('m.id', '=', membershipId).where('m.user_id', '=', userId).executeTakeFirst();
    if (!m) throw Problem.notFound('membership_not_found', 'There is no membership here');
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return {
      id: m.id, community: { id: m.community_id, name: m.name, slug: m.slug }, status: m.status, source: m.source, onboarding_step: m.onboarding_step,
      trial_ends_at: iso(m.trial_ends_at), current_period_end: iso(m.current_period_end),
      switch_offer: m.community_status === 'banned',
    };
  }

  private async redeem(userId: string, code: string) {
    const ac = await this.accessCode(code, 'join');
    const id = await this.db.asEngine(async (trx) => {
      const claimed = await trx.updateTable('access_codes').set({ status: 'redeemed', redeemed_by: userId, redeemed_at: sql`now()` }).where('id', '=', ac.id).where('status', '=', 'unused').returning('id').executeTakeFirst();
      if (!claimed) throw Problem.conflict('code_used', 'This code has already been used');
      const existing = await trx.selectFrom('memberships').select(['id', 'status', 'current_period_end', 'onboarding_step']).where('user_id', '=', userId).where('community_id', '=', ac.community.id).executeTakeFirst();
      const from = Math.max(Date.now(), existing?.status === 'active' && existing.current_period_end ? new Date(existing.current_period_end as unknown as string).getTime() : 0);
      const end = addDays(new Date(from), PERIOD_DAYS[ac.grants_period]);
      const row = existing
        ? await trx.updateTable('memberships').set({ status: 'active', current_period_end: end, current_period_start: existing.status === 'active' ? sql`current_period_start` : sql`now()`, cancelled_at: null, onboarding_step: existing.onboarding_step === 'joined' ? 'paid' : existing.onboarding_step }).where('id', '=', existing.id).returning('id').executeTakeFirstOrThrow()
        : await trx.insertInto('memberships').values({ user_id: userId, community_id: ac.community.id, status: 'active', source: 'access_code', onboarding_step: 'paid', current_period_start: sql`now()`, current_period_end: end }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('access_codes').set({ membership_id: row.id }).where('id', '=', ac.id).execute();
      await trx.updateTable('users').set({ referred_by_community_id: ac.community.id }).where('id', '=', userId).where('referred_by_community_id', 'is', null).execute();
      return row.id;
    });
    return this.view(userId, id);
  }

  private async communityByCode(code: string) {
    return this.db.k.selectFrom('communities').selectAll().where((eb) => eb.or([eb('invite_code', '=', code), eb('slug', '=', code)])).where('status', '=', 'active').executeTakeFirst();
  }

  private async accessCode(code: string, mode: 'page' | 'join' = 'page') {
    const ac = await this.db.asEngine((trx) =>
      trx.selectFrom('access_codes as a').innerJoin('code_batches as b', 'b.id', 'a.batch_id').select(['a.id', 'a.status', 'a.community_id', 'b.grants_period']).where('a.code', '=', code.trim()).executeTakeFirst(),
    );
    if (!ac) throw Problem.notFound('invite_not_found', 'This link or code does not match a community');
    if (ac.status !== 'unused') {
      const title = ac.status === 'void' ? 'This code no longer works' : 'This code has already been used';
      throw mode === 'join' ? Problem.conflict('code_used', title) : Problem.notFound('code_used', title);
    }
    const community = await this.db.k.selectFrom('communities').selectAll().where('id', '=', ac.community_id).executeTakeFirstOrThrow();
    if (community.status !== 'active') throw Problem.notFound('code_used', 'This code no longer works');
    return { id: ac.id, grants_period: ac.grants_period, community };
  }

  private async publicCommunity(c: { id: string; name: string; slug: string; description: string | null; verified_at: unknown }) {
    const f = await this.db.k.selectFrom('community_funnel').select(['paid', 'on_trial']).where('community_id', '=', c.id).executeTakeFirst();
    return { id: c.id, name: c.name, slug: c.slug, description: c.description, member_count: Number(f?.paid ?? 0) + Number(f?.on_trial ?? 0), verified: !!c.verified_at };
  }

  private async own(userId: string, membershipId: string) {
    const m = await this.db.k.selectFrom('memberships as m').innerJoin('communities as c', 'c.id', 'm.community_id')
      .select(['m.id', 'm.status', 'm.community_id', 'c.trial_enabled', 'c.price_kobo', 'c.name as community_name', 'c.status as community_status'])
      .where('m.id', '=', membershipId).where('m.user_id', '=', userId).executeTakeFirst();
    if (!m) throw Problem.notFound('membership_not_found', 'There is no membership here');
    return m;
  }

  private async assertAdult(userId: string) {
    const u = await this.db.k.selectFrom('users').select('age_band').where('id', '=', userId).executeTakeFirstOrThrow();
    if (u.age_band === 'under_13' || u.age_band === 'teen') throw Problem.forbidden('age_restricted', 'i-jobs communities are for adults (18+)');
  }

  private async matchingInvite(userId: string, communityId: string) {
    const u = await this.db.k.selectFrom('users').select(['email', 'phone']).where('id', '=', userId).executeTakeFirstOrThrow();
    const targets = [u.email, u.phone].filter((t): t is string => !!t);
    if (!targets.length) return undefined;
    return this.db.k.selectFrom('community_invites').select('id').where('community_id', '=', communityId).where('target', 'in', targets).where('status', '!=', 'revoked').executeTakeFirst();
  }

  private async wasInBannedCommunity(userId: string) {
    return !!(await this.db.k.selectFrom('memberships as m').innerJoin('communities as c', 'c.id', 'm.community_id').select('m.id').where('m.user_id', '=', userId).where('c.status', '=', 'banned').executeTakeFirst());
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

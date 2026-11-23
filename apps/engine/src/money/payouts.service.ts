import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { money } from '../communities/shared';
import { recordPayout } from './ledger';

/**
 * Owner payouts, monthly. Only money older than the holding period (chargebacks), only above the
 * minimum, only to verified owners with no open fraud signals. During the beta a person sends each
 * transfer: release → finance sends it from the Paga business account → mark paid with the reference.
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Worker, 1st of the month: one payout per community whose settled balance passes the minimum. */
  async createMonthly(): Promise<{ created: number }> {
    return this.db.asEngine(async (trx) => {
      const rows = await sql<{ community_id: string; settled: string; pending: string }>`
        SELECT c.id AS community_id,
               coalesce((SELECT -sum(amount_kobo) FROM ledger_entries l
                          WHERE l.community_id = c.id AND l.account = 'owner_payable'
                            AND (l.amount_kobo > 0 OR l.created_at < now() - make_interval(days => ${this.config.PAYOUT_HOLD_DAYS}))), 0) AS settled,
               coalesce((SELECT sum(amount_kobo) FROM payouts p WHERE p.community_id = c.id AND p.status IN ('held', 'ready', 'processing', 'frozen')), 0) AS pending
          FROM communities c
         WHERE c.status = 'active'`.execute(trx);
      let created = 0;
      for (const r of rows.rows) {
        const amount = Number(r.settled) - Number(r.pending);
        if (amount < this.config.PAYOUT_MINIMUM_KOBO) continue;
        await trx.insertInto('payouts').values({ community_id: r.community_id, amount_kobo: amount, status: 'ready', hold_until: sql`now()` }).execute();
        created++;
      }
      return { created };
    });
  }

  async list(status?: string) {
    let q = this.db.asEngine((trx) => {
      let query = trx.selectFrom('payouts as p').innerJoin('communities as c', 'c.id', 'p.community_id').innerJoin('owner_profiles as o', 'o.user_id', 'c.owner_user_id')
        .select(['p.id', 'p.amount_kobo', 'p.status', 'p.hold_until', 'p.paid_at', 'p.frozen_reason', 'p.provider_ref', 'c.id as community_id', 'c.name', 'o.legal_name', 'o.bank_code', 'o.bank_account_last4', 'o.identity_verified_at']);
      if (status) query = query.where('p.status', '=', status as never);
      return query.orderBy('p.created_at', 'desc').limit(500).execute();
    });
    const rows = await q;
    return {
      items: rows.map((p) => ({
        id: p.id, amount: money(p.amount_kobo), status: p.status, hold_until: new Date(p.hold_until as unknown as string).toISOString(),
        paid_at: p.paid_at ? new Date(p.paid_at as unknown as string).toISOString() : null, frozen_reason: p.frozen_reason, reference: p.provider_ref,
        community: { id: p.community_id, name: p.name }, payee: { legal_name: p.legal_name, bank_code: p.bank_code, account_last4: p.bank_account_last4, identity_verified: !!p.identity_verified_at },
      })),
      next_cursor: null,
    };
  }

  async release(payoutId: string, staffId: string) {
    return this.db.asEngine(async (trx) => {
      const p = await trx.selectFrom('payouts as p').innerJoin('communities as c', 'c.id', 'p.community_id').innerJoin('owner_profiles as o', 'o.user_id', 'c.owner_user_id')
        .select(['p.id', 'p.status', 'p.hold_until', 'p.community_id', 'o.identity_verified_at', 'o.payout_eligible', 'o.banned_at']).where('p.id', '=', payoutId).forUpdate().executeTakeFirst();
      if (!p) throw Problem.notFound('payout_not_found', 'There is no payout here');
      if (!['ready', 'held'].includes(p.status)) throw Problem.conflict('payout_not_ready', `This payout is ${p.status}`);
      if (new Date(p.hold_until as unknown as string).getTime() > Date.now()) throw Problem.conflict('still_on_hold', 'This payout is still in its holding period');
      if (!p.identity_verified_at || !p.payout_eligible || p.banned_at) throw Problem.conflict('identity_unverified', "The owner's identity and bank account are not verified");
      const fraud = await trx.selectFrom('fraud_signals').select('id').where('community_id', '=', p.community_id).where('status', '=', 'open').executeTakeFirst();
      if (fraud) throw Problem.conflict('fraud_review', 'This community has an open fraud review');
      await trx.updateTable('payouts').set({ status: 'processing' }).where('id', '=', payoutId).execute();
      await trx.insertInto('audit_log').values({ actor_user_id: staffId, actor_kind: 'staff', action: 'payout.release', subject_type: 'payout', subject_id: payoutId, meta: '{}' }).execute();
      return { id: payoutId, status: 'processing' };
    });
  }

  /** Finance confirms the transfer went out. Only now does the ledger move money. */
  async markPaid(payoutId: string, staffId: string, reference: string) {
    return this.db.asEngine(async (trx) => {
      const p = await trx.updateTable('payouts').set({ status: 'paid', paid_at: sql`now()`, provider_ref: reference }).where('id', '=', payoutId).where('status', '=', 'processing').returning(['id', 'community_id', 'amount_kobo']).executeTakeFirst();
      if (!p) throw Problem.conflict('payout_not_processing', 'Release the payout before marking it paid');
      await recordPayout(trx, { payoutId: p.id, communityId: p.community_id, amountKobo: Number(p.amount_kobo) });
      await trx.insertInto('audit_log').values({ actor_user_id: staffId, actor_kind: 'staff', action: 'payout.paid', subject_type: 'payout', subject_id: payoutId, meta: JSON.stringify({ reference }) }).execute();
      return { id: payoutId, status: 'paid' };
    });
  }

  /** Worker, daily: cheap checks that open fraud reviews. A person decides. */
  async fraudChecks(): Promise<{ opened: number }> {
    return this.db.asEngine(async (trx) => {
      const found = await sql<{ kind: string; community_id: string | null; details: unknown }>`
        -- One card paying for many accounts.
        SELECT 'shared_card' AS kind, NULL::uuid AS community_id, jsonb_build_object('card', card_fingerprint, 'accounts', count(DISTINCT user_id)) AS details
          FROM payments WHERE status = 'succeeded' AND card_fingerprint IS NOT NULL AND paid_at > now() - interval '30 days'
         GROUP BY card_fingerprint HAVING count(DISTINCT user_id) >= 4
        UNION ALL
        -- Many paid members who never set anything up: possibly owner-bought memberships.
        SELECT 'inactive_paid_members', m.community_id, jsonb_build_object('paid', count(*), 'never_set_up', count(*) FILTER (WHERE m.onboarding_step IN ('joined', 'paid')))
          FROM memberships m WHERE m.status = 'active' AND m.current_period_start < now() - interval '14 days'
         GROUP BY m.community_id HAVING count(*) >= 10 AND count(*) FILTER (WHERE m.onboarding_step IN ('joined', 'paid')) >= 0.7 * count(*)
        UNION ALL
        -- Refunds and reversals piling up.
        SELECT 'chargeback_spike', p.community_id, jsonb_build_object('reversed', count(*))
          FROM payments p WHERE p.status IN ('refunded', 'reversed') AND p.updated_at > now() - interval '30 days' AND p.community_id IS NOT NULL
         GROUP BY p.community_id HAVING count(*) >= 3`.execute(trx);
      let opened = 0;
      for (const f of found.rows) {
        const open = await trx.selectFrom('fraud_signals').select('id').where('kind', '=', f.kind as never).where('status', '=', 'open')
          .where((eb) => (f.community_id ? eb('community_id', '=', f.community_id) : eb('details', '@>', JSON.stringify({ card: (f.details as { card?: string }).card }) as never))).executeTakeFirst();
        if (open) continue;
        await trx.insertInto('fraud_signals').values({ kind: f.kind as never, community_id: f.community_id, details: JSON.stringify(f.details) }).execute();
        opened++;
      }
      return { opened };
    });
  }
}

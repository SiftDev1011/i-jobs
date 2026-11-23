import { randomUUID } from 'node:crypto';
import { Kysely } from 'kysely';
import { DB } from '../db/schema';

/**
 * Double-entry ledger. Every money event is one txn_id whose lines add up to zero.
 * Debits are positive, credits negative:
 *   cash +  (money in)          cash −  (money out)
 *   platform_revenue −          (our earnings)
 *   owner_payable −  (we owe the owner)   owner_payable +  (paid them / took it back)
 */
type Line = { account: 'cash' | 'platform_revenue' | 'owner_payable' | 'provider_fees' | 'refunds'; amount: number; communityId?: string | null };

async function post(trx: Kysely<DB>, lines: Line[], refs: { paymentId?: string; payoutId?: string; memo: string }) {
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (sum !== 0) throw new Error(`Ledger lines must add up to zero (off by ${sum})`);
  const txn = randomUUID();
  await trx
    .insertInto('ledger_entries')
    .values(
      lines
        .filter((l) => l.amount !== 0)
        .map((l) => ({ txn_id: txn, account: l.account, amount_kobo: l.amount, community_id: l.communityId ?? null, payment_id: refs.paymentId ?? null, payout_id: refs.payoutId ?? null, memo: refs.memo })),
    )
    .execute();
  return txn;
}

/** A member's payment: our share, the rest owed to the community. */
export function recordMembershipPayment(trx: Kysely<DB>, p: { paymentId: string; communityId: string; amountKobo: number; shareBps: number; feeKobo?: number }) {
  const share = Math.round((p.amountKobo * p.shareBps) / 10_000);
  const fee = p.feeKobo ?? 0;
  return post(
    trx,
    [
      { account: 'cash', amount: p.amountKobo - fee },
      { account: 'provider_fees', amount: fee },
      { account: 'platform_revenue', amount: -share },
      { account: 'owner_payable', amount: -(p.amountKobo - share), communityId: p.communityId },
    ],
    { paymentId: p.paymentId, memo: 'membership payment' },
  );
}

/** An owner prepaying our share for a batch of Selar codes: all ours. */
export function recordCodeBatchPayment(trx: Kysely<DB>, p: { paymentId: string; amountKobo: number; feeKobo?: number }) {
  const fee = p.feeKobo ?? 0;
  return post(
    trx,
    [
      { account: 'cash', amount: p.amountKobo - fee },
      { account: 'provider_fees', amount: fee },
      { account: 'platform_revenue', amount: -p.amountKobo },
    ],
    { paymentId: p.paymentId, memo: 'code batch' },
  );
}

/** Money leaves for the owner's bank. */
export function recordPayout(trx: Kysely<DB>, p: { payoutId: string; communityId: string; amountKobo: number }) {
  return post(
    trx,
    [
      { account: 'owner_payable', amount: p.amountKobo, communityId: p.communityId },
      { account: 'cash', amount: -p.amountKobo },
    ],
    { payoutId: p.payoutId, memo: 'payout' },
  );
}

/** A refund reverses the payment in the same proportions. */
export function recordRefund(trx: Kysely<DB>, p: { paymentId: string; communityId: string | null; amountKobo: number; shareBps: number }) {
  const share = p.communityId ? Math.round((p.amountKobo * p.shareBps) / 10_000) : p.amountKobo;
  return post(
    trx,
    [
      { account: 'refunds', amount: 0 },
      { account: 'platform_revenue', amount: share },
      ...(p.communityId ? [{ account: 'owner_payable' as const, amount: p.amountKobo - share, communityId: p.communityId }] : []),
      { account: 'cash', amount: -p.amountKobo },
    ],
    { paymentId: p.paymentId, memo: 'refund' },
  );
}

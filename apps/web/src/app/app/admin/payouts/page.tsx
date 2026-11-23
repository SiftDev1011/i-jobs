import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { amount, dateLabel } from '@/lib/format';
import { PAYOUT_STATUS } from '@/lib/labels';
import { StatusChip } from '../../_parts/chip';
import u from '../../_ui/ui.module.css';
import { MarkPaid, Release } from '../_parts/payout-parts';
import { needs } from '../_parts/staff';

const FILTERS = [['', 'All'], ['ready', 'Ready'], ['held', 'Held'], ['processing', 'Sending'], ['frozen', 'Frozen'], ['paid', 'Paid'], ['failed', 'Failed']] as const;
type Status = Exclude<(typeof FILTERS)[number][0], ''>;

export default async function Payouts({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await needs('/app/admin/payouts');
  const { status: raw } = await searchParams;
  const status = FILTERS.some(([k]) => k && k === raw) ? (raw as Status) : undefined;
  const items = must(await (await engine()).GET('/admin/payouts', { params: { query: status ? { status } : {} } })).items ?? [];
  const now = Date.now();
  return (
    <>
      <div className={u.checks}>
        {FILTERS.map(([k, label]) => <Link key={k} className={u.check} href={`/app/admin/payouts${k ? `?status=${k}` : ''}`} style={(status ?? '') === k ? { background: 'var(--ink)', color: 'var(--white)', borderColor: 'var(--ink)' } : undefined}>{label}</Link>)}
      </div>
      <p className={u.muted}>Release a payout once its hold has passed, send it from the Paga business account, then mark it paid with the transfer reference. Only then does the ledger move.</p>
      {items.length === 0 ? <div className={u.empty}><p>No payouts here.</p></div> : (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead><tr><th>Community</th><th>Pay to</th><th>Amount</th><th>Status</th><th>Hold ends</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((p) => {
                const held = p.hold_until ? new Date(p.hold_until).getTime() > now : false;
                return (
                  <tr key={p.id}>
                    <td><b>{p.community?.name}</b></td>
                    <td>{p.payee?.legal_name}<br /><span className={u.muted}>Bank {p.payee?.bank_code ?? '—'} · ••{p.payee?.account_last4 ?? '—'}{p.payee?.identity_verified ? '' : ' · not verified'}</span></td>
                    <td className={u.num}><b>{amount(p.amount)}</b></td>
                    <td><StatusChip value={p.status} map={PAYOUT_STATUS} />{p.frozen_reason && <><br /><span className={u.muted}>{p.frozen_reason}</span></>}{p.reference && <><br /><span className={u.muted}>Ref {p.reference}</span></>}</td>
                    <td className={u.num}>{dateLabel(p.hold_until)}</td>
                    <td>
                      {(p.status === 'ready' || p.status === 'held') && !held && <Release id={p.id!} />}
                      {p.status === 'processing' && <MarkPaid id={p.id!} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

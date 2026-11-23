import { engine, must } from '@/lib/engine';
import { amount, dateLabel } from '@/lib/format';
import { PAYOUT_STATUS } from '@/lib/labels';
import { StatusChip } from '../../../_parts/chip';
import u from '../../../_ui/ui.module.css';
import { loadCommunity } from '../../_parts/load';

export default async function Earnings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCommunity(id);
  const e = must(await (await engine()).GET('/owner/communities/{communityId}/earnings', { params: { path: { communityId: id } } }));
  const payouts = e.payouts ?? [];
  return (
    <>
      <div className={u.grid3}>
        <div className={u.stat}><span>Ready for your next payout</span><b>{amount(e.balance)}</b></div>
        <div className={u.stat}><span>On hold</span><b>{amount(e.on_hold)}</b></div>
        <div className={u.stat}><span>Next payout</span><b style={{ fontSize: 20 }}>{dateLabel(e.next_payout_at)}</b></div>
      </div>
      <p className={u.muted}>
        You keep {100 - (c.platform_share_percent ?? 0)}% of every membership paid in {c.name}. New money is held for a short time in case a payment is reversed,
        then paid to your bank account once a month.
      </p>
      <section className={u.section}>
        <h2 className={u.h2}>Payouts</h2>
        {payouts.length === 0 ? <p className={u.muted}>No payouts yet.</p> : (
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th>Amount</th><th>Status</th><th>Held until</th><th>Paid</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className={u.num} style={{ textAlign: 'left' }}><b>{amount(p.amount)}</b></td>
                    <td><StatusChip value={p.status} map={PAYOUT_STATUS} />{p.status === 'frozen' && <><br /><span className={u.muted}>Contact support about this payout.</span></>}</td>
                    <td className={u.num}>{dateLabel(p.hold_until)}</td>
                    <td className={u.num}>{dateLabel(p.paid_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

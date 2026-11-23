import { engine, must } from '@/lib/engine';
import { amount, dateLabel } from '@/lib/format';
import { PERIOD_LABEL } from '@/lib/labels';
import u from '../../../_ui/ui.module.css';
import { CodesForm } from '../../_parts/codes-form';
import { loadCommunity } from '../../_parts/load';

export default async function Codes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCommunity(id);
  const batches = must(await (await engine()).GET('/owner/communities/{communityId}/code-batches', { params: { path: { communityId: id } } }));
  const unit = Math.round(((c.price?.amount_minor ?? 0) * (c.platform_share_percent ?? 0)) / 100);

  return (
    <>
      <section className={u.section}>
        <h2 className={u.h2}>Sell memberships on Selar</h2>
        <p className={u.muted}>
          Buy single-use codes up front and sell them on Selar (or anywhere) at your own price. Each code is i-jobs’ share of one membership
          {c.billing_period ? ` (${PERIOD_LABEL[c.billing_period] ?? c.billing_period})` : ''}, so whatever you charge above that is yours straight away.
          Buyers enter the code on your join page.
        </p>
        <div className={u.card}>{c.status === 'active' ? <CodesForm id={id} unitMinor={unit} /> : <p className={u.muted}>Codes are available once {c.name} is approved.</p>}</div>
      </section>
      <section className={u.section}>
        <h2 className={u.h2}>Your batches</h2>
        {batches.length === 0 ? <p className={u.muted}>No codes bought yet.</p> : (
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th>Bought</th><th>Codes</th><th>Used</th><th>Left</th><th>Paid</th><th><span className="sr-only">Download</span></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className={u.num} style={{ textAlign: 'left' }}>{dateLabel(b.created_at)}</td>
                    <td className={u.num}>{b.quantity}</td>
                    <td className={u.num}>{b.redeemed}</td>
                    <td className={u.num}>{b.unused}</td>
                    <td>{b.paid ? amount(b.total) : <span className={`${u.chip} ${u.yellow}`}>Not paid</span>}</td>
                    <td>{b.paid ? <a className="btn btn-line btn-sm" href={`/app/owner/batches/${b.id}/csv`} download>Download CSV</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={u.help}>The CSV has one code per line, ready to upload to Selar as digital keys.</p>
      </section>
    </>
  );
}

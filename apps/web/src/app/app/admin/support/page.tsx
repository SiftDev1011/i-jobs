import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import u from '../../_ui/ui.module.css';
import { needs } from '../_parts/staff';

const FILTERS = [['', 'Not resolved'], ['waiting_human', 'Waiting for us'], ['open', 'Answered, open'], ['resolved', 'Resolved']] as const;
const CATEGORY: Record<string, string> = { payment: 'Payment', scam_report: 'Scam report', data_request: 'Data', other: 'Other' };

export default async function SupportQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await needs('/app/admin/support');
  const { status: raw } = await searchParams;
  const status = FILTERS.some(([k]) => k && k === raw) ? (raw as 'waiting_human' | 'open' | 'resolved') : undefined;
  const page = must(await (await engine()).GET('/admin/support/tickets', { params: { query: status ? { status } : {} } }));
  const items = page.items ?? [];
  return (
    <>
      <div className={u.checks}>
        {FILTERS.map(([k, label]) => <Link key={k} className={u.check} href={`/app/admin/support${k ? `?status=${k}` : ''}`} style={(status ?? '') === k ? { background: 'var(--ink)', color: 'var(--white)', borderColor: 'var(--ink)' } : undefined}>{label}</Link>)}
      </div>
      {items.length === 0 ? <div className={u.empty}><p>No tickets here.</p></div> : (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead><tr><th>Subject</th><th>Type</th><th>Status</th><th>Opened</th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/app/admin/support/${t.id}`}><b>{t.subject}</b></Link></td>
                  <td>{t.category === 'payment' || t.category === 'scam_report' ? <span className={`${u.chip} ${u.bad}`}>{CATEGORY[t.category]}</span> : CATEGORY[t.category ?? 'other'] ?? t.category}</td>
                  <td>{t.status === 'waiting_human' ? <span className={`${u.chip} ${u.yellow}`}>Waiting for us</span> : t.status === 'resolved' ? <span className={`${u.chip} ${u.good}`}>Resolved</span> : <span className={`${u.chip} ${u.gray}`}>{t.status}</span>}</td>
                  <td className={u.num}>{dateLabel(t.created_at, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={u.help}>Oldest first. Money and scam questions skip the assistant and land here straight away.</p>
    </>
  );
}

import { engine, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import u from '../../_ui/ui.module.css';
import { CloseRequest } from '../_parts/data-request-parts';
import { needs } from '../_parts/staff';

const TYPE: Record<string, string> = { export: 'Copy of data', delete: 'Delete account', correct: 'Correction', human_review: 'Human review' };

export default async function DataRequests() {
  await needs('/app/admin/data-requests');
  const rows = must(await (await engine()).GET('/admin/data-requests'));
  return (
    <>
      <p className={u.muted}>Exports run by themselves. Deletions run 48 hours after the request unless you stop them here. Corrections and reviews also open a support ticket.</p>
      {rows.length === 0 ? <div className={u.empty}><p>No open requests.</p></div> : (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead><tr><th>Request</th><th>Person</th><th>Details</th><th>Due</th><th><span className="sr-only">Close</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{TYPE[r.type ?? ''] ?? r.type}</b><br /><span className={u.muted}>{r.status}{r.type === 'delete' && r.process_after ? ` · runs ${dateLabel(r.process_after, true)}` : ''}</span></td>
                  <td><code className={u.small}>{r.user_id?.slice(0, 8)}</code></td>
                  <td style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{r.details ?? '—'}</td>
                  <td className={u.num}>{dateLabel(r.due_at)}</td>
                  <td>{r.type !== 'export' && <CloseRequest id={r.id!} type={r.type ?? ''} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

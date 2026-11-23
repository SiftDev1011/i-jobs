import Link from 'next/link';
import { notFound } from 'next/navigation';
import { engine, maybe } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import s from '../../../help/tickets/[id]/ticket.module.css';
import u from '../../../_ui/ui.module.css';
import { needs } from '../../_parts/staff';
import { StaffReply } from './staff-reply';

const WHO = { user: 'Member', bot: 'Assistant', staff: 'i-jobs team' } as const;

export default async function StaffTicket({ params }: { params: Promise<{ id: string }> }) {
  await needs('/app/admin/support');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = maybe(await (await engine()).GET('/admin/support/tickets/{ticketId}', { params: { path: { ticketId: id } } }));
  if (!t) notFound();
  return (
    <>
      <p className={u.crumb}><Link href="/app/admin/support">Support</Link><span>/</span><span>{t.category}</span></p>
      <div className={`${u.row} ${u.between}`}>
        <h2 className={u.h2} style={{ fontSize: 22 }}>{t.subject}</h2>
        <span className={`${u.chip} ${t.status === 'resolved' ? u.good : t.status === 'waiting_human' ? u.yellow : u.gray}`}>{t.status}</span>
      </div>
      <ol className={s.thread}>
        {(t.messages ?? []).map((m, i) => (
          <li key={i} className={m.author === 'staff' ? s.mine : s.theirs}>
            <span className={s.who}>{WHO[m.author ?? 'user']} · {dateLabel(m.at, true)}</span>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
      <div className={u.card}><StaffReply ticketId={id} /></div>
    </>
  );
}

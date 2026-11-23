import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { engine, maybe } from '@/lib/engine';
import u from '../../../_ui/ui.module.css';
import { ReplyForm } from './reply-form';
import s from './ticket.module.css';

export const metadata: Metadata = { title: 'Conversation' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHO = { user: 'You', bot: 'Assistant', staff: 'i-jobs team' } as const;

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = maybe(await (await engine()).GET('/support/tickets/{ticketId}', { params: { path: { ticketId: id } } }));
  if (!t) notFound();
  return (
    <main className={u.page}>
      <p className={u.small}><Link href="/app/help">Help</Link> / Conversation</p>
      <h1 className={u.h1}>{t.subject}</h1>
      <ol className={s.thread}>
        {(t.messages ?? []).map((m, i) => (
          <li key={i} className={m.author === 'user' ? s.mine : s.theirs}>
            <span className={s.who}>{WHO[m.author ?? 'user']} · {m.at ? new Date(m.at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos',  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
      {t.status === 'waiting_human' && <p className={u.muted}>Our team usually replies within a working day. We&rsquo;ll notify you.</p>}
      <ReplyForm ticketId={t.id!} />
    </main>
  );
}

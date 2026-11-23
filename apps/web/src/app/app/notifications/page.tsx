import type { Metadata } from 'next';
import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { timeAgo } from '@/lib/format';
import u from '../_ui/ui.module.css';
import { MarkAllRead } from './mark-all-read';
import s from './notifications.module.css';

export const metadata: Metadata = { title: 'Notifications' };

/** Where a notification leads, from its data. */
function hrefFor(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  if (typeof data.application_id === 'string') return `/app/applications/${data.application_id}`;
  if (typeof data.job_id === 'string') return `/app/jobs/${data.job_id}`;
  if (typeof data.ticket_id === 'string') return `/app/help/tickets/${data.ticket_id}`;
  return null;
}

export default async function Notifications({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const page = must(await (await engine()).GET('/me/notifications', { params: { query: { cursor, limit: 30 } } }));
  const items = page.items ?? [];
  return (
    <main className={u.page}>
      <div className={u.head}>
        <h1 className={u.h1}>Notifications</h1>
        {(page.unread_count ?? 0) > 0 && <MarkAllRead />}
      </div>
      {!items.length ? <div className={u.empty}><p>Nothing yet. Replies, interviews and anything that needs you will show up here.</p></div> : (
        <ul className={s.list}>
          {items.map((n) => {
            const href = hrefFor(n.data);
            const body = (
              <>
                {!n.read && <span className={s.dot} aria-label="Unread" />}
                <span className={s.text}><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
                <time className={s.time} dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
              </>
            );
            return <li key={n.id} className={n.read ? '' : s.unread}>{href ? <Link href={href} className={s.item}>{body}</Link> : <div className={s.item}>{body}</div>}</li>;
          })}
        </ul>
      )}
      {page.next_cursor && <Link className="btn btn-line btn-sm" href={`/app/notifications?cursor=${encodeURIComponent(page.next_cursor)}`}>Older</Link>}
    </main>
  );
}

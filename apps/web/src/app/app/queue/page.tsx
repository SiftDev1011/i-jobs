import type { Metadata } from 'next';
import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { companyTile } from '@/lib/format';
import { QUEUE_WHY } from '@/lib/labels';
import { Gate, gated } from '../_ui/gate';
import u from '../_ui/ui.module.css';
import s from '../matches/matches.module.css';

export const metadata: Metadata = { title: 'Apply queue' };

export default async function Queue({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const api = await engine();
  const r = await gated(async () => must(await api.GET('/me/queue', { params: { query: { cursor, limit: 20 } } })));
  return (
    <main className={`${u.page} ${u.wide}`}>
      <div>
        <h1 className={u.h1}>Apply queue</h1>
        <p className={u.lead}>Good matches autopilot can&rsquo;t send for you. We prepare the answers; you apply in a couple of minutes.</p>
      </div>
      {r.gate ? <Gate error={r.gate} /> : !r.data.items?.length ? (
        <div className={u.empty}><p>Your queue is empty. Matches land here when they need you to apply yourself.</p></div>
      ) : (
        <ul className={u.list}>
          {r.data.items.map((q) => {
            const t = companyTile(q.job?.company_name ?? '?');
            return (
              <li key={q.job?.id} className={`${u.card} ${s.match}`}>
                <div className={s.top}>
                  <span className={`tile ${t.colour}`}>{t.initials}</span>
                  <div className={s.title}>
                    <Link href={`/app/jobs/${q.job?.id}`} className={s.link}>{q.job?.title}</Link>
                    <p className={u.muted}>{q.job?.company_name}</p>
                  </div>
                  {q.score != null && <span className={`${u.score} t-green`}>{q.score}%</span>}
                </div>
                {q.why_in_queue && <p className={u.muted}>{QUEUE_WHY[q.why_in_queue]}</p>}
                {q.warning && <p className={u.notice}>{q.warning}</p>}
                <div className={s.actions}><Link className="btn btn-green btn-sm" href={`/app/jobs/${q.job?.id}`}>{q.pack_ready ? 'Open apply pack' : 'Prepare and apply'}</Link></div>
              </li>
            );
          })}
        </ul>
      )}
      {r.data?.next_cursor && <Link className="btn btn-line btn-sm" href={`/app/queue?cursor=${encodeURIComponent(r.data.next_cursor)}`}>More</Link>}
    </main>
  );
}

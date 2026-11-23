import type { Metadata } from 'next';
import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { companyTile, timeAgo } from '@/lib/format';
import { APPLICATION_STATUS, MODE } from '@/lib/labels';
import { Gate, gated } from '../_ui/gate';
import u from '../_ui/ui.module.css';
import s from './applications.module.css';

export const metadata: Metadata = { title: 'Applications' };
type Status = 'scheduled' | 'sent' | 'replied' | 'interview' | 'offer' | 'hired' | 'rejected' | 'no_response' | 'failed' | 'cancelled' | 'sending';
const FILTERS: [string, string, Status[] | undefined][] = [
  ['all', 'All', undefined],
  ['waiting', 'Waiting to send', ['scheduled']],
  ['sent', 'Sent', ['sent', 'no_response']],
  ['replies', 'Replies', ['replied', 'interview', 'offer', 'hired', 'rejected']],
];

export default async function Applications({ searchParams }: { searchParams: Promise<{ f?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const f = FILTERS.find(([k]) => k === sp.f) ?? FILTERS[0];
  const api = await engine();
  const r = await gated(async () => must(await api.GET('/me/applications', { params: { query: { status: f[2], cursor: sp.cursor, limit: 25 } } })));
  const t = r.data?.totals;

  return (
    <main className={`${u.page} ${u.wide}`}>
      <div>
        <h1 className={u.h1}>Applications</h1>
        <p className={u.lead}>Everything sent for you or by you, and every reply. Scheduled ones can be cancelled before they go.</p>
      </div>
      {t && (
        <section className={u.grid4} aria-label="Totals">
          <div className={u.stat}><span>Sent</span><b>{t.sent ?? 0}</b></div>
          <div className={u.stat}><span>Replies</span><b>{t.replies ?? 0}</b></div>
          <div className={u.stat}><span>Interviews</span><b>{t.interviews ?? 0}</b></div>
          <div className={u.stat}><span>Offers</span><b>{t.offers ?? 0}</b></div>
        </section>
      )}
      <nav className={u.tabs} aria-label="Filter">
        {FILTERS.map(([k, l]) => <Link key={k} href={`/app/applications?f=${k}`} aria-current={f[0] === k ? 'page' : undefined}>{l}</Link>)}
      </nav>
      {r.gate ? <Gate error={r.gate} /> : !r.data.items?.length ? (
        <div className={u.empty}><p>Nothing here yet.</p><Link className="btn btn-line btn-sm" href="/app/matches">See your matches</Link></div>
      ) : (
        <ul className={s.table}>
          {r.data.items.map((a) => {
            const st = APPLICATION_STATUS[a.status] ?? { label: a.status, cls: 't-ink' };
            const tile = companyTile(a.job.company_name);
            const when = a.status === 'scheduled' ? `Sends ${a.scheduled_for ? new Date(a.scheduled_for).toLocaleString('en-NG', { timeZone: 'Africa/Lagos',  weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon'}` : a.sent_at ? `Sent ${timeAgo(a.sent_at)}` : '';
            return (
              <li key={a.id}>
                <Link href={`/app/applications/${a.id}`} className={s.row}>
                  <span className={`tile ${tile.colour}`}>{tile.initials}</span>
                  <span className={s.job}><b>{a.job.title}</b><span>{a.job.company_name}</span></span>
                  <span className={s.meta}>{MODE[a.mode]}{when ? ` · ${when}` : ''}</span>
                  {a.open_checkin && <span className={`${u.chip} t-yellow`}>Did you hear back?</span>}
                  <span className={`${u.chip} ${st.cls}`}>{st.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {r.data?.next_cursor && <Link className="btn btn-line btn-sm" href={`/app/applications?f=${f[0]}&cursor=${encodeURIComponent(r.data.next_cursor)}`}>More</Link>}
    </main>
  );
}

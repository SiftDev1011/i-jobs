import type { Metadata } from 'next';
import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { companyTile, payLabel, typeLabel, whereLabel } from '@/lib/format';
import { Gate, gated } from '../_ui/gate';
import u from '../_ui/ui.module.css';
import { MatchActions } from './match-actions';
import s from './matches.module.css';

export const metadata: Metadata = { title: 'Matches' };
const TABS = [['new', 'New'], ['saved', 'Saved'], ['seen', 'Seen']] as const;

export default async function Matches({ searchParams }: { searchParams: Promise<{ tab?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? 'new';
  const api = await engine();
  const r = await gated(async () => must(await api.GET('/me/matches', { params: { query: { status: [tab], cursor: sp.cursor, limit: 20 } } })));

  return (
    <main className={`${u.page} ${u.wide}`}>
      <div>
        <h1 className={u.h1}>Matches</h1>
        <p className={u.lead}>Jobs ranked by how well they fit your profile. Strong ones inside your rules go out with autopilot.</p>
      </div>
      <nav className={u.tabs} aria-label="Match lists">
        {TABS.map(([k, l]) => <Link key={k} href={`/app/matches?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{l}</Link>)}
      </nav>
      {r.gate ? <Gate error={r.gate} /> : !r.data.items?.length ? (
        <div className={u.empty}><p>{tab === 'new' ? 'No new matches right now. New jobs arrive through the day, and a fuller profile finds more.' : 'Nothing here yet.'}</p><Link className="btn btn-line btn-sm" href="/app/profile">Improve your profile</Link></div>
      ) : (
        <ul className={u.list}>
          {r.data.items.map((m) => {
            const t = companyTile(m.job.company_name);
            const pay = payLabel(m.job.pay);
            return (
              <li key={m.job.id} className={`${u.card} ${s.match}`}>
                <div className={s.top}>
                  <span className={`tile ${t.colour}`}>{t.initials}</span>
                  <div className={s.title}>
                    <Link href={`/app/jobs/${m.job.id}`} className={s.link}>{m.job.title}</Link>
                    <p className={u.muted}>{m.job.company_name} · {whereLabel(m.job)}{typeLabel(m.job.employment_type) ? ` · ${typeLabel(m.job.employment_type)}` : ''}{pay ? ` · ${pay.amount} ${pay.period}` : ''}</p>
                  </div>
                  <span className={`${u.score} ${m.score >= 80 ? 't-green' : m.score >= 65 ? 't-blue' : 't-ink'}`}>{m.score}%</span>
                </div>
                {m.reasons.length > 0 && <ul className={s.reasons}>{m.reasons.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>}
                {m.gaps.length > 0 && (
                  <p className={s.gaps}>
                    <span>To get closer:</span>
                    {m.gaps.slice(0, 3).map((g, i) => g.training ? (
                      <a key={i} href={g.training.url} target="_blank" rel="noopener noreferrer" className="tag t-yellow">{g.skill}: {g.training.title}{g.training.is_free ? ' (free)' : ''}</a>
                    ) : <span key={i} className="tag">{g.skill}</span>)}
                  </p>
                )}
                <MatchActions jobId={m.job.id} status={m.status} />
              </li>
            );
          })}
        </ul>
      )}
      {r.data?.next_cursor && <Link className="btn btn-line btn-sm" href={`/app/matches?tab=${tab}&cursor=${encodeURIComponent(r.data.next_cursor)}`}>More</Link>}
    </main>
  );
}

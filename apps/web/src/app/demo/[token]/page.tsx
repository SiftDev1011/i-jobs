import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JobCard } from '@/components/job-card';
import { PublicPage } from '@/components/public-page';
import { engine } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import { SAMPLE_JOBS } from '../../_landing/samples';
import u from '../../app/_ui/ui.module.css';
import p from '../../_public/public.module.css';

export const metadata: Metadata = { title: 'A tour of i-jobs', robots: { index: false } };

const SCORES = [94, 91, 88, 85, 82, 79];
const REASONS = ['Your SQL and Excel match what they need', 'Open to people in Nigeria', 'Pay is above your floor', 'Entry level, fits two years’ experience', 'Fully remote, Lagos hours overlap', 'Uses tools from your last job'];

/** What an owner's demo link opens: a read-only member view with sample data. Nothing here is real or sent. */
export default async function DemoTour({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = await engine({ anonymous: true });
  const demo = (await api.GET('/demo/{token}', { params: { path: { token } } }).catch(() => null))?.data;
  if (!demo) notFound();
  const live = (await api.GET('/job-finds', { params: { query: { limit: 12 } } }).catch(() => null))?.data?.items ?? [];
  const seen = new Set<string>();
  const unique = live.filter((j) => { const k = `${j.title}|${j.company_name}`.toLowerCase(); return !seen.has(k) && !!seen.add(k); });
  const jobs = (unique.length >= 3 ? unique : SAMPLE_JOBS).slice(0, 6).map((j, i) => ({ ...j, match_score: SCORES[i] }));
  const name = demo.community.name;

  return (
    <PublicPage className={p.main}>
      <p className={`${u.notice} ${u.info}`} role="note">A tour from <b>{name}</b>. The member, matches and applications below are samples — nothing here is sent. This link ends {dateLabel(demo.expires_at, true)}.</p>
      <header className={p.hero}>
        <span className={p.kicker}>What members of {name} get</span>
        <h1 className={p.h1}>Meet Ada. She uploaded her CV once.</h1>
        <p className={p.lead}>i-jobs read it, built her profile, and now matches her to remote jobs every morning. Autopilot applies to the best ones within her rules, and she can cancel any of them before they go.</p>
        <div className={p.ctas}><Link className="btn btn-green" href={`/join/${encodeURIComponent(demo.community.slug ?? '')}`}>Join {name}</Link></div>
      </header>

      <section className={p.section}>
        <h2 className={p.h2}>Her profile</h2>
        <div className={u.card} style={{ maxWidth: 760 }}>
          <div className={`${u.row} ${u.between}`}><b style={{ fontSize: 17 }}>Ada O. · Data analyst</b><span className={`${u.chip} ${u.good}`}>Profile confirmed</span></div>
          <p className={u.muted}>2 years at a Lagos fintech · B.Sc. Statistics, UNILAG · Remote, Lagos time ±3 hours</p>
          <div className={u.checks}>{['SQL', 'Excel', 'Power BI', 'Python', 'Stakeholder reporting'].map((s) => <span key={s} className="tag">{s}</span>)}</div>
        </div>
      </section>

      <section className={p.section}>
        <h2 className={p.h2}>This morning’s matches</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {jobs.map((j, i) => (
            <div key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <JobCard job={j} compact />
              <span className={u.small} style={{ color: 'var(--ink-2)' }}>Why: {REASONS[i]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={p.section}>
        <h2 className={p.h2}>Autopilot, within her rules</h2>
        <ul className={p.points}>
          <li><span className={p.tick} aria-hidden="true">✓</span><span><b>Up to 5 applications a day</b>, only to jobs scoring 80 or more.</span></li>
          <li><span className={p.tick} aria-hidden="true">✓</span><span><b>Two hours to cancel</b> any application before it’s sent.</span></li>
          <li><span className={p.tick} aria-hidden="true">✓</span><span><b>A note written for each job</b>, with her CV attached.</span></li>
          <li><span className={p.tick} aria-hidden="true">✓</span><span><b>Replies sorted for her</b>: interview invites go to the top.</span></li>
        </ul>
      </section>

      <section className={p.section}>
        <h2 className={p.h2}>Her week</h2>
        <div className={u.tableWrap} style={{ maxWidth: 760 }}>
          <table className={u.table}>
            <thead><tr><th>Job</th><th>Status</th></tr></thead>
            <tbody>
              {jobs.slice(0, 4).map((j, i) => (
                <tr key={j.id}><td><b>{j.title}</b><br /><span className={u.muted}>{j.company_name}</span></td>
                  <td><span className={`${u.chip} ${[u.good, u.purple, u.info, u.gray][i]}`}>{['Interview', 'Replied', 'Sent', 'Sending in 2h'][i]}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={p.band}>
        <h2 className={p.h2}>Get this for yourself</h2>
        <p className={p.lead} style={{ fontSize: 15.5 }}>Join {name} on i-jobs, upload your CV, and your first matches arrive tomorrow morning.</p>
        <div><Link className="btn btn-green" href={`/join/${encodeURIComponent(demo.community.slug ?? '')}`}>Join {name}</Link></div>
      </section>
    </PublicPage>
  );
}

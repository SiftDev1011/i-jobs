import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Description } from '@/components/job-description';
import { engine, EngineError, maybe } from '@/lib/engine';
import { companyTile, jobBadge, payLabel, typeLabel, whereLabel } from '@/lib/format';
import u from '../../_ui/ui.module.css';
import { ApplyPanel } from './apply-panel';
import { ReportJob } from './report-job';
import s from './member-job.module.css';

export const metadata: Metadata = { title: 'Job' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MemberJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let job;
  try {
    job = maybe(await (await engine()).GET('/jobs/{jobId}', { params: { path: { jobId: id } } }));
  } catch (e) {
    if (e instanceof EngineError && e.status === 410) {
      return <main className={u.page}><h1 className={u.h1}>This job has closed</h1><Link className="btn btn-line btn-sm" href="/app/matches">Back to matches</Link></main>;
    }
    throw e;
  }
  if (!job) notFound();
  const t = companyTile(job.company_name);
  const badge = jobBadge(job);
  const pay = payLabel(job.pay);
  const unverified = job.trust === 'unverified';

  return (
    <main className={`${u.page} ${u.wide} ${s.layout}`}>
      <article className={s.main}>
        <p className={u.small}><Link href="/app/matches">Matches</Link> / {job.company_name}</p>
        <div className={s.head}>
          <span className={`tile ${t.colour} ${s.tile}`}>{t.initials}</span>
          <div><h1 className={u.h1}>{job.title}</h1><p className={u.muted}>{job.company_name}{job.community?.name ? ` · shared by ${job.community.name}` : ''}</p></div>
        </div>
        <div className={u.row}>
          {job.match_score != null && <span className={`${u.score} t-green`}>{job.match_score}% match</span>}
          <span className="tag">{whereLabel(job)}</span>
          {typeLabel(job.employment_type) && <span className="tag">{typeLabel(job.employment_type)}</span>}
          {badge && <span className={`badge ${badge.cls}`}><Icon name={badge.icon} />{badge.label}</span>}
          {pay && <span className="tag">{pay.amount} {pay.period}</span>}
        </div>
        {unverified && <p className={u.notice}>We couldn&rsquo;t verify this employer. Never pay a fee, and don&rsquo;t share your BVN or bank details. Report the job if anything feels off.</p>}
        {job.description ? <Description text={job.description} /> : <p>{job.summary}</p>}
        {job.source?.credit && <p className={u.small}>{job.source.url ? <a href={job.source.url} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: 'underline' }}>{job.source.credit}</a> : job.source.credit}</p>}
        <ReportJob jobId={job.id} />
      </article>
      <aside className={s.side}>
        <ApplyPanel jobId={job.id} autopilot={!!job.apply?.autopilot_eligible} />
      </aside>
    </main>
  );
}

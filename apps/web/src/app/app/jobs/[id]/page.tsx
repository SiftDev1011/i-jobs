import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Description } from '@/components/job-description';
import { JobHeader } from '@/components/job-header';
import { SimilarJobs } from '@/components/similar-jobs';
import { engine, EngineError, maybe } from '@/lib/engine';
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
  const unverified = job.trust === 'unverified';

  return (
    <main className={`${u.page} ${u.wide}`}>
      <p className={u.small}><Link href="/app/matches">Matches</Link> / {job.company_name}</p>
      <div className={s.layout}>
        <div className={s.headArea}><JobHeader job={job} /></div>
        <article className={s.body}>
          {unverified && <p className={u.notice}>We couldn&rsquo;t verify this employer. Never pay a fee, and don&rsquo;t share your BVN or bank details. Report the job if anything feels off.</p>}
          {job.skills?.length ? (
            <section>
              <h2 className={s.sec}>Skills</h2>
              <ul className={s.skills}>{job.skills.map((k) => <li key={k} className="tag t-blue">{k}</li>)}</ul>
            </section>
          ) : null}
          <section>
            <h2 className={s.sec}>Job description</h2>
            {job.description ? <Description text={job.description} /> : <p>{job.summary}</p>}
          </section>
          {job.source?.credit && <p className={u.small}>Found {job.source.url ? <a href={job.source.url} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: 'underline' }}>{job.source.credit}</a> : job.source.credit}</p>}
          <ReportJob jobId={job.id} />
        </article>
        <aside className={s.side}>
          <ApplyPanel jobId={job.id} autopilot={!!job.apply?.autopilot_eligible} />
        </aside>
      </div>
      <SimilarJobs id={job.id} base="/app/jobs" />
    </main>
  );
}

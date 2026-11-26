import { engine } from '@/lib/engine';
import { JobCard, type JobSummary } from './job-card';
import s from './similar-jobs.module.css';

/** "Recommended jobs" under a job: others like it. Shows nothing if there are none or the engine can't say. */
export async function SimilarJobs({ id, base = '/jobs' }: { id: string; base?: string }) {
  let items: JobSummary[] = [];
  try {
    const r = await (await engine()).GET('/jobs/{jobId}/similar', { params: { path: { jobId: id }, query: { limit: 8 } } });
    items = r.data?.items ?? [];
  } catch {
    return null;
  }
  if (!items.length) return null;
  return (
    <section className={s.similar} aria-labelledby="similar-h">
      <h2 id="similar-h" className={s.h}>Recommended jobs</h2>
      <p className={s.sub}>Similar roles you might also like.</p>
      <div className={s.grid}>{items.map((j) => <JobCard key={j.id} job={j} base={base} />)}</div>
    </section>
  );
}

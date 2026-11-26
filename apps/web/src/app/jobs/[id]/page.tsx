import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { Icon } from '@/components/icons';
import { OnboardButton } from '@/components/onboard-button';
import { OnboardSheet } from '@/components/onboard-sheet';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine, EngineError, maybe } from '@/lib/engine';
import { payLabel } from '@/lib/format';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { Description } from '@/components/job-description';
import { JobHeader } from '@/components/job-header';
import { SimilarJobs } from '@/components/similar-jobs';
import s from './job.module.css';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return { job: null, closed: false };
  try {
    const api = await engine();
    return { job: maybe(await api.GET('/jobs/{jobId}', { params: { path: { jobId: id } } })), closed: false };
  } catch (e) {
    if (e instanceof EngineError && e.status === 410) return { job: null, closed: true };
    throw e;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { job } = await load((await params).id).catch(() => ({ job: null }));
  return job ? { title: `${job.title} at ${job.company_name}`, description: job.summary ?? undefined } : { title: 'Job' };
}

export default async function JobPage({ params }: Params) {
  const { id } = await params;
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const { job, closed } = await load(id);

  if (closed) {
    return (
      <div className="page">
        <SiteNav signedIn={signedIn} solid />
        <main className={`wrap ${s.closed}`}>
          <h1>This job has closed</h1>
          <p>It&rsquo;s no longer taking applications. There are plenty more like it.</p>
          <Link className="btn btn-green" href="/jobs">Browse open jobs</Link>
        </main>
        <SiteFooter />
      </div>
    );
  }
  if (!job) notFound();

  const pay = payLabel(job.pay);

  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className={`wrap ${s.wrap}`}>
        <p className={s.crumb}><Link href="/jobs">Jobs</Link> / {job.company_name}</p>
        <div className={s.layout}>
          <div className={s.headArea}><JobHeader job={job} /></div>

          <article className={s.body}>
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
            {job.source?.credit && (
              <p className={s.credit}>
                Found {job.source.url ? <a href={job.source.url} target="_blank" rel="noopener noreferrer nofollow">{job.source.credit}</a> : job.source.credit}
              </p>
            )}
          </article>

          <aside className={s.side}>
            <div className={s.box}>
              {pay && <p className={s.pay}>{pay.amount} <small>{pay.period}</small></p>}
              <p className={s.trust}>
                <Icon name="shield" />
                {job.trust === 'verified_employer' ? 'Verified employer' : job.trust === 'careers_page' ? 'From the company’s careers page' : 'Employer not verified'}
              </p>
              {signedIn ? (
                <Link className="btn btn-green btn-block" href={`/app/jobs/${job.id}`}>Apply with i-jobs</Link>
              ) : (
                <>
                  <OnboardButton className="btn btn-green btn-block">Join to apply</OnboardButton>
                  <p className="hint">i-jobs members apply in one tap, or let autopilot do it.</p>
                </>
              )}
            </div>
            <p className={s.safe}><Icon name="shield" />Never pay to apply for a job. If a recruiter asks for money, your BVN or bank details, report the job.</p>
          </aside>
        </div>

        <SimilarJobs id={job.id} />
      </main>
      <SiteFooter />
      <OnboardSheet />
    </div>
  );
}

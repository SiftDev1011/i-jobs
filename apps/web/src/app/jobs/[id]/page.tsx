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
import { companyTile, jobBadge, payLabel, timeAgo, typeLabel, whereLabel } from '@/lib/format';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { Description } from '@/components/job-description';
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

  const tile = companyTile(job.company_name);
  const badge = jobBadge(job);
  const pay = payLabel(job.pay);
  const type = typeLabel(job.employment_type);

  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className={`wrap ${s.layout}`}>
        <article className={s.main}>
          <p className={s.crumb}><Link href="/jobs">Jobs</Link> / {job.company_name}</p>
          <div className={s.head}>
            <span className={`tile ${tile.colour} ${s.tile}`}>{tile.initials}</span>
            <div>
              <h1 className={s.h}>{job.title}</h1>
              <p className={s.co}>{job.company_name}{job.community?.name ? ` · shared by ${job.community.name}` : ''}</p>
            </div>
          </div>
          <div className={s.tags}>
            <span className="tag">{whereLabel(job)}</span>
            {type && <span className="tag">{type}</span>}
            {job.seniority && <span className="tag">{job.seniority}</span>}
            {badge && <span className={`badge ${badge.cls}`}><Icon name={badge.icon} />{badge.label}</span>}
            {job.match_score != null && <span className="tag t-green">{job.match_score}% match</span>}
          </div>
          {job.skills?.length ? <div className={s.tags}>{job.skills.map((k) => <span key={k} className="tag t-blue">{k}</span>)}</div> : null}
          {job.description ? <Description text={job.description} /> : <p>{job.summary}</p>}
        </article>

        <aside className={s.side}>
          <div className={s.box}>
            {pay ? <p className={s.pay}>{pay.amount} <small>{pay.period}</small></p> : <p className={s.payNone}>Pay not stated</p>}
            <dl className={s.facts}>
              {job.first_seen_at && <div><dt>Found</dt><dd>{timeAgo(job.first_seen_at)}</dd></div>}
              {job.deadline_at && <div><dt>Closes</dt><dd>{new Date(job.deadline_at).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos',  weekday: 'short', day: 'numeric', month: 'short' })}</dd></div>}
              <div><dt>Employer</dt><dd>{job.trust === 'verified_employer' ? 'Verified' : job.trust === 'careers_page' ? 'From their careers page' : 'Not verified'}</dd></div>
            </dl>
            {signedIn ? (
              <Link className="btn btn-green btn-block" href={`/app/jobs/${job.id}`}>Apply with i-jobs</Link>
            ) : (
              <>
                <OnboardButton className="btn btn-green btn-block">Join to apply</OnboardButton>
                <p className="hint">i-jobs members apply in one tap, or let autopilot do it.</p>
              </>
            )}
            {job.source?.credit && (
              <p className={s.credit}>
                {job.source.url ? <a href={job.source.url} target="_blank" rel="noopener noreferrer nofollow">{job.source.credit}</a> : job.source.credit}
              </p>
            )}
          </div>
          <p className={s.safe}><Icon name="shield" />Never pay to apply for a job. If a recruiter asks for money, your BVN or bank details, report the job.</p>
        </aside>
      </main>
      <SiteFooter />
      <OnboardSheet />
    </div>
  );
}

import { Icon } from '@/components/icons';
import { JobCard, type JobSummary } from '@/components/job-card';
import { OnboardButton } from '@/components/onboard-button';
import { OnboardSheet } from '@/components/onboard-sheet';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine } from '@/lib/engine';
import { env } from '@/lib/env';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { FloorTable } from './_landing/floor-table';
import s from './_landing/landing.module.css';
import { PasteDemo } from './_landing/paste-demo';
import { PastelBg } from './_landing/pastel-bg';
import { RollingWord } from './_landing/rolling-word';
import { SAMPLE_JOBS } from './_landing/samples';
import { Typewriter } from './_landing/typewriter';

export const revalidate = 0;

/** The newest public job finds for the wall; samples only in development. */
async function wallJobs(): Promise<{ jobs: JobSummary[]; samples: boolean }> {
  try {
    const api = await engine({ anonymous: true });
    const r = await api.GET('/job-finds', { params: { query: { limit: 18 } } });
    const jobs = r.data?.items ?? [];
    if (jobs.length >= 6) return { jobs, samples: false };
  } catch {
    /* engine unreachable */
  }
  return env.LANDING_SAMPLE_JOBS ? { jobs: SAMPLE_JOBS, samples: true } : { jobs: [], samples: false };
}

const RAINBOW = 'Check us out'.split('');

export default async function Landing() {
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const { jobs, samples } = await wallJobs();
  const cols = [0, 1, 2].map((c) => jobs.filter((_, i) => i % 3 === c));

  return (
    <>
      <SiteNav signedIn={signedIn} />
      <main>
        <section className={s.hero} aria-label="Introduction">
          <FloorTable searchId="hero-search" />
          <div className={`wrap ${s['hero-copy']}`}>
            <h1>We <RollingWord /> jobs for you</h1>
            <form className={s.search} id="hero-search" role="search" action="/jobs">
              <label className={s['s-field']}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input type="search" name="q" placeholder="Search a role, skill or company" aria-label="Search jobs" autoComplete="off" />
              </label>
              <button className={s['s-go']} type="submit" aria-label="Search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </form>
          </div>
        </section>

        <section className={s.wall} id="jobs" aria-labelledby="wall-h">
          <div className="wrap">
            <h2 id="wall-h">
              <span className={s.wq}>Want a new <Typewriter />?</span><br />
              <span className={s.rainbow} aria-label="Check us out">
                {RAINBOW.map((c, i) => (c === ' ' ? ' ' : <span key={i}>{c}</span>))}
              </span>
            </h2>
            {jobs.length > 0 ? (
              <div className={s.marquee}>
                {cols.map((list, c) => (
                  <div key={c} className={`${s.col} ${c === 1 ? s.down : ''}`}>
                    <div className={s.list}>
                      {list.map((j) => <JobCard key={j.id} job={j} compact />)}
                      {list.map((j) => <JobCard key={`${j.id}-again`} job={j} compact hidden />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <p className={s.sub}>Remote jobs open to people in Nigeria and across Africa, checked and matched every day.</p>
            {samples && <p className={s.note}>Sample listings (development only). The live page shows jobs open today.</p>}
            {!jobs.length && <p className={s.note}><a className="btn btn-line btn-sm" href="/jobs">Browse jobs</a></p>}
          </div>
        </section>

        <section className={s.join} id="join" data-bg="pastel" aria-labelledby="join-h">
          <div className={`wrap ${s['join-in']}`}>
            <div>
              <h2 id="join-h">Join your community and get started</h2>
              <p className={s.sub}>i-jobs is a paid membership you get through your job community. Your community owner gives you an invite code, you pay your membership, and you&rsquo;re in. Each membership is shared between your community and i-jobs.</p>
              <ol className={s.steps}>
                <li><span className={`${s.n} t-blue`}>1</span><div><h3>Find your community</h3><p>Ask the job group you&rsquo;re already in on WhatsApp or Telegram, or pick a verified community on i-jobs.</p></div></li>
                <li><span className={`${s.n} t-yellow`}>2</span><div><h3>Enter your invite code</h3><p>Tap Onboard, enter the code and pay your community&rsquo;s membership fee to unlock i-jobs.</p></div></li>
                <li><span className={`${s.n} t-red`}>3</span><div><h3>Upload your CV and set your rules</h3><p>We turn your CV into a profile. Choose your lowest pay, match level and where you can work.</p></div></li>
                <li><span className={`${s.n} t-purple`}>4</span><div><h3>Let i-jobs get to work</h3><p>New matches every day, applications sent for you, and every reply tracked in one place.</p></div></li>
              </ol>
            </div>
            <div className={s.mock}>
              <div className={`${s.app} ${s.onb}`} aria-label="Example: joining with an invite code">
                <div className={s['app-bar']}><span className={s.dots} aria-hidden="true"><i /><i /><i /></span><span className={s.addr}>ijobs.app/join</span></div>
                <div className={s['onb-body']}>
                  <div className={s['onb-steps']}><span>Step 2 of 4</span><span className="mute">Invite code</span></div>
                  <div className={s.prog} aria-hidden="true"><i style={{ width: '50%' }} /></div>
                  <h4 className={s['onb-h']}>Enter your invite code</h4>
                  <div className={s['code-box']}><span className={s['code-val']}>LTH-2048</span><span className={s['ok-dot']}><Icon name="check" />Valid</span></div>
                  <div className={s.found}>
                    <div className={s['found-top']}>
                      <span className="tile t-blue">LT</span>
                      <div className={s['found-id']}><h5>Lagos Tech Hustlers</h5><p>248 members · run by Tunde B.</p></div>
                      <span className="badge b-green"><Icon name="shield" />Verified</span>
                    </div>
                    <dl className={s.facts}>
                      <div><dt>Membership</dt><dd>Set by your community</dd></div>
                      <div><dt>Autopilot</dt><dd>Included</dd></div>
                      <div><dt>Jobs shared this month</dt><dd>36</dd></div>
                    </dl>
                  </div>
                  <OnboardButton className={`btn btn-green ${s['onb-go']}`}>Continue</OnboardButton>
                </div>
              </div>
              <OnboardButton tab="find" className={`btn btn-line ${s['find-link']}`}>Find a community</OnboardButton>
            </div>
          </div>
        </section>

        <section className={s.band} id="communities" data-bg="pastel" aria-labelledby="band-h">
          <div className={`wrap ${s['band-in']}`}>
            <div>
              <h2 id="band-h">Run a job community? Bring i-jobs to your members</h2>
              <p className={s.sub}>Your members get autopilot, matching and tracking. You set the price and earn from every member you bring.</p>
              <ul className={s.perks}>
                {['Set your own membership price', 'Each membership is split between you and i-jobs', 'Paste a job and it becomes a clean listing in seconds', 'Every community is verified by our team'].map((p) => (
                  <li key={p}><span className={s.ck}><Icon name="check" /></span>{p}</li>
                ))}
              </ul>
              <a className="btn btn-yellow" href="/owners/apply">Apply as a community</a>
            </div>
            <PasteDemo />
          </div>
        </section>

        <section className={s.close} aria-labelledby="close-h">
          <div className="wrap">
            <h2 id="close-h">Start your search right now</h2>
            <p>Get your invite code from your community, onboard in ten minutes and let i-jobs do the searching.</p>
            <OnboardButton>Onboard</OnboardButton>
          </div>
        </section>
      </main>
      <SiteFooter />
      <OnboardSheet />
      <PastelBg />
    </>
  );
}

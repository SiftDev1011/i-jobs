import type { Metadata } from 'next';
import Link from 'next/link';
import { isSignedIn, PublicPage } from '@/components/public-page';
import p from '../_public/public.module.css';

export const metadata: Metadata = { title: 'Hire on i-jobs', description: 'Post remote jobs to people across Africa who have a profile, a CV and a reason to apply well.' };

const Tick = () => <span className={p.tick} aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>;

export default async function Employers() {
  const signedIn = await isSignedIn();
  const start = signedIn ? '/app/employer' : '/sign-in?next=/app/employer';
  return (
    <PublicPage className={p.main}>
      <header className={p.hero}>
        <span className={p.kicker}>For employers</span>
        <h1 className={p.h1}>Hire remote talent from people who are ready to work</h1>
        <p className={p.lead}>
          Everyone on i-jobs has a profile built from their CV and is matched to jobs on skills, location and pay. Your job reaches the people it fits,
          and every application comes with a CV and a short note written for your role.
        </p>
        <div className={p.ctas}>
          <Link className="btn btn-green" href={start}>Verify your company</Link>
          <Link className="btn btn-line" href="/jobs">See jobs on i-jobs</Link>
        </div>
      </header>

      <section className={p.section}>
        <h2 className={p.h2}>Three checks, then you’re verified</h2>
        <ol className={p.steps}>
          <li><b>Work email</b><p>We email a code to your address on the company domain. Free email providers can’t be used.</p></li>
          <li><b>Website</b><p>We check your website is live on https and on the same domain.</p></li>
          <li><b>Registration</b><p>A person checks your CAC (or your country’s) registration number, usually within two working days.</p></li>
        </ol>
        <p className={p.lead} style={{ fontSize: 15.5 }}>You can post straight away. Until all three checks are done, a person looks at each job before it goes live.</p>
      </section>

      <section className={p.section}>
        <h2 className={p.h2}>What you get</h2>
        <ul className={p.points}>
          <li><Tick /><span><b>A verified badge.</b> Job seekers see that your company was checked, so the good ones apply.</span></li>
          <li><Tick /><span><b>Applications by email.</b> Each one arrives with a CV attached; reply and it reaches the applicant.</span></li>
          <li><Tick /><span><b>A cap you control.</b> Close a job automatically after a set number of applicants.</span></li>
          <li><Tick /><span><b>Your hiring system.</b> Connect Greenhouse, Lever or Ashby. Keys are tested, encrypted and never shown again.</span></li>
          <li><Tick /><span><b>No scams next to you.</b> Every post is screened. Jobs that ask applicants for money are removed.</span></li>
          <li><Tick /><span><b>Remote-first.</b> Say who can apply — anywhere, or only certain countries — and we only match those people.</span></li>
        </ul>
      </section>

      <section className={p.band}>
        <h2 className={p.h2}>Already list jobs on Greenhouse, Lever or Ashby?</h2>
        <p className={p.lead} style={{ fontSize: 15.5 }}>We may already show your public job board. Verify your company to get the badge and see how many people applied through i-jobs.</p>
        <div><Link className="btn btn-green" href={start}>Get started</Link></div>
      </section>
    </PublicPage>
  );
}

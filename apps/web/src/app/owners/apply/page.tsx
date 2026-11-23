import type { Metadata } from 'next';
import Link from 'next/link';
import { isSignedIn, PublicPage } from '@/components/public-page';
import { engine, features } from '@/lib/engine';
import { env } from '@/lib/env';
import p from '../../_public/public.module.css';
import { ApplyForm } from './apply-form';

export const metadata: Metadata = { title: 'Run a community on i-jobs', description: 'Bring AI job matching and applying to your WhatsApp or Telegram job group.' };

const Tick = () => <span className={p.tick} aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>;

export default async function OwnersApply() {
  const signedIn = await isSignedIn();
  const api = signedIn ? await engine() : null;
  const [rules, mine] = api ? await Promise.all([api.GET('/owner/pricing-rules'), api.GET('/owner/communities')]) : [null, null];
  const communities = mine?.data ?? [];
  const f = await features();

  return (
    <PublicPage className={p.main}>
      <header className={p.hero}>
        <span className={p.kicker}>For community owners</span>
        <h1 className={p.h1}>Your job group, now with jobs applied for</h1>
        <p className={p.lead}>
          You already share jobs with hundreds of people. i-jobs gives each of them a profile from their CV, matches them to remote jobs every day, and applies within
          rules they set. You set the membership price and earn from every member who pays.
        </p>
        <div className={p.ctas}>
          <a className="btn btn-green" href="#apply">Apply now</a>
          <Link className="btn btn-line" href="/help?q=community%20owner">Questions owners ask</Link>
        </div>
      </header>

      <section className={p.section}>
        <h2 className={p.h2}>How it works</h2>
        <ol className={p.steps}>
          <li><b>Apply</b><p>Tell us about you and your group. A person checks it within two working days.</p></li>
          <li><b>Share your link</b><p>Post your join link or invite code in the group, or send invites by email and text from your dashboard.</p></li>
          <li><b>Members get hired</b><p>They upload a CV once; i-jobs matches and applies. You see who’s set up and how many interviews they land.</p></li>
        </ol>
      </section>

      <section className={p.section}>
        <h2 className={p.h2}>What you get</h2>
        <ul className={p.points}>
          <li><Tick /><span><b>Your price, paid monthly.</b> Members pay through Paga and your share goes to your bank account.</span></li>
          <li><Tick /><span><b>Post jobs by pasting.</b> Paste a job from the chat; our AI turns it into a clean listing for you to check.</span></li>
          <li><Tick /><span><b>A dashboard that respects members.</b> First names and progress only — never phone numbers or CVs.</span></li>
          <li><Tick /><span><b>Sell on Selar too.</b> Buy single-use codes up front and sell memberships wherever you already sell.</span></li>
        </ul>
      </section>

      <section className={p.section} id="apply" style={{ scrollMarginTop: 96 }}>
        <h2 className={p.h2}>Apply to run a community</h2>
        {!signedIn || !rules?.data ? (
          <div className={p.band}>
            <p>Log in or create your i-jobs account first. It takes a minute with a code sent to your {f.phone_sign_in ? 'email or phone' : 'email'}.</p>
            <div><Link className="btn btn-green" href="/sign-in?next=/owners/apply%23apply">Log in to apply</Link></div>
          </div>
        ) : (
          <>
            {communities.length > 0 && <p className={p.lead} style={{ fontSize: 15.5 }}>You already run {communities.map((c) => c.name).join(', ')}. <Link href="/app/owner" style={{ textDecoration: 'underline' }}>Go to your dashboard</Link>, or apply for another below.</p>}
            <ApplyForm minNaira={rules.data.minimum_price.amount_minor / 100} share={rules.data.platform_share_percent} appUrl={env.PUBLIC_APP_URL} freeWeeks={f.free_weeks} />
          </>
        )}
      </section>
    </PublicPage>
  );
}

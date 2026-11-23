import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteNav } from '@/components/site-nav';
import { currentUser, engine, EngineError, must } from '@/lib/engine';
import { LinkDecision } from './link-decision';
import s from '../../join/[code]/join.module.css';

export const metadata: Metadata = { title: 'Link your account', robots: { index: false } };
const SHARES: Record<string, string> = { profile: 'Your profile', matches: 'Your matches', applications: 'Your applications', notifications: 'Your notifications' };

/** A partner site asked to link to this person's i-jobs account (from the emailed link). */
export default async function LinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await currentUser())) redirect(`/sign-in?next=${encodeURIComponent(`/link/${token}`)}`);
  let view: { site?: string; shares?: string[] } | null = null;
  let problem: string | null = null;
  try {
    view = must(await (await engine()).GET('/partner/links/{token}', { params: { path: { token } } }));
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    problem = e.code === 'wrong_account' ? 'This link was sent to a different account. Log out and log in with the email it was sent to.' : 'This link has expired or was already used.';
  }
  return (
    <div className="page">
      <SiteNav signedIn solid />
      <main className={`wrap ${s.main}`}>
        <div className={s.card}>
          {problem ? <><h1 style={{ fontSize: 24 }}>Can&rsquo;t link</h1><p>{problem}</p></> : (
            <>
              <h1 style={{ fontSize: 24, letterSpacing: '-0.02em' }}>Link your i-jobs account to {view!.site}?</h1>
              <p>{view!.site} will see:</p>
              <ul className={s.gets}>{(view!.shares ?? []).map((x) => <li key={x}>{SHARES[x] ?? x}</li>)}</ul>
              <p className="hint">You can unlink any time from Settings. Nothing is shared if you say no.</p>
              <LinkDecision token={token} site={view!.site ?? 'this site'} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

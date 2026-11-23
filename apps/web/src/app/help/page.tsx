import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine } from '@/lib/engine';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import s from '../communities/communities.module.css';

export const metadata: Metadata = { title: 'Help centre' };
const STARTERS = ['How does autopilot work?', 'How do I join a community?', 'Is i-jobs free?', 'How do I spot a scam job?', 'When do community owners get paid?'];

export default async function HelpCentre({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const query = q?.trim().slice(0, 200);
  const hits = query && query.length >= 2 ? ((await (await engine({ anonymous: true })).GET('/help/search', { params: { query: { q: query } } }).catch(() => null))?.data ?? []) : [];
  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className={`wrap ${s.main}`} style={{ maxWidth: 820 }}>
        <h1 className={s.h}>How can we help?</h1>
        <form className={s.search} action="/help" role="search">
          <input className="input" name="q" defaultValue={query} placeholder="Search the help articles" aria-label="Search help" />
          <button className="btn btn-green">Search</button>
        </form>
        {!query && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{STARTERS.map((x) => <Link key={x} className="btn btn-line btn-sm" href={`/help?q=${encodeURIComponent(x)}`}>{x}</Link>)}</div>}
        {query && (hits.length === 0 ? <p className={s.empty}>No articles match that.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hits.map((h, i) => (
              <details key={i} open={i === 0} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                <summary className="sum-wide" style={{ fontWeight: 600 }}>{h.question}</summary>
                <p style={{ color: 'var(--ink-2)', marginTop: 10, whiteSpace: 'pre-wrap' }}>{h.answer}</p>
              </details>
            ))}
          </div>
        ))}
        <p style={{ color: 'var(--ink-2)', marginTop: 16 }}>Still stuck? {signedIn ? <Link href="/app/help" style={{ textDecoration: 'underline' }}>Ask us or contact a person</Link> : <><Link href="/sign-in?next=/app/help" style={{ textDecoration: 'underline' }}>Log in</Link> to ask us or contact a person.</>}</p>
      </main>
      <SiteFooter />
    </div>
  );
}

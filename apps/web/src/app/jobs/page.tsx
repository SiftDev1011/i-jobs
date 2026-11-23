import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { JobCard } from '@/components/job-card';
import { OnboardSheet } from '@/components/onboard-sheet';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine, must } from '@/lib/engine';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import s from './jobs.module.css';

export const metadata: Metadata = { title: 'Remote jobs' };

const TYPES = [['full_time', 'Full time'], ['part_time', 'Part time'], ['contract', 'Contract'], ['freelance', 'Freelance'], ['internship', 'Internship'], ['graduate', 'Graduate']] as const;
const CATEGORIES = [['customer-support', 'Customer support'], ['design', 'Design'], ['data', 'Data'], ['writing', 'Writing'], ['engineering', 'Engineering'], ['sales', 'Sales']] as const;
type Search = { q?: string; type?: string; category?: string; verified?: string; worldwide?: string; cursor?: string };

export default async function Jobs({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const q = sp.q?.trim().slice(0, 120) || undefined;
  const type = TYPES.find(([k]) => k === sp.type)?.[0];
  const category = CATEGORIES.find(([k]) => k === sp.category)?.[0];

  let page: { items?: Parameters<typeof JobCard>[0]['job'][]; next_cursor?: string | null } = {};
  let failed = false;
  try {
    const api = await engine();
    page = must(await api.GET('/jobs', {
      params: { query: { q, employment_type: type ? [type] : undefined, category, verified_only: sp.verified === '1' || undefined, location: sp.worldwide === '1' ? ['worldwide'] : undefined, cursor: sp.cursor, limit: 24 } },
    }));
  } catch {
    failed = true;
  }

  const link = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, cursor: undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const qs = p.toString();
    return `/jobs${qs ? `?${qs}` : ''}`;
  };
  const items = page.items ?? [];

  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className="wrap">
        <header className={s.head}>
          <h1 className={s.h}>{q ? <>Jobs for &ldquo;{q}&rdquo;</> : 'Remote jobs you can actually get'}</h1>
          <form className={s.search} role="search" action="/jobs">
            <input className="input" type="search" name="q" defaultValue={q} placeholder="Search a role, skill or company" aria-label="Search jobs" />
            {type && <input type="hidden" name="type" value={type} />}
            {category && <input type="hidden" name="category" value={category} />}
            <button className="btn btn-green">Search</button>
          </form>
          <div className={s.filters} aria-label="Filters">
            {CATEGORIES.map(([k, label]) => (
              <Link key={k} href={link({ category: category === k ? undefined : k })} className={`${s.chip} ${category === k ? s.on : ''}`} aria-pressed={category === k}>{label}</Link>
            ))}
            <span className={s.sep} aria-hidden="true" />
            {TYPES.map(([k, label]) => (
              <Link key={k} href={link({ type: type === k ? undefined : k })} className={`${s.chip} ${type === k ? s.on : ''}`} aria-pressed={type === k}>{label}</Link>
            ))}
            <span className={s.sep} aria-hidden="true" />
            <Link href={link({ worldwide: sp.worldwide === '1' ? undefined : '1' })} className={`${s.chip} ${sp.worldwide === '1' ? s.on : ''}`}>Worldwide only</Link>
            <Link href={link({ verified: sp.verified === '1' ? undefined : '1' })} className={`${s.chip} ${sp.verified === '1' ? s.on : ''}`}>Verified employers</Link>
          </div>
        </header>

        {failed ? (
          <p className={s.empty}>We couldn&rsquo;t load jobs just now. Try again in a minute.</p>
        ) : items.length === 0 ? (
          <p className={s.empty}>No jobs match that yet. Try fewer words or another filter.</p>
        ) : (
          <div className={s.grid}>{items.map((j) => <JobCard key={j.id} job={j} />)}</div>
        )}
        {page.next_cursor && (
          <p className={s.more}><Link className="btn btn-line" href={link({ cursor: page.next_cursor })}>More jobs</Link></p>
        )}
        {!signedIn && (
          <aside className={s.cta}>
            <div><h2>Want i-jobs to apply for you?</h2><p>Members get matches to their CV and applications sent inside their own rules.</p></div>
            <Link className="btn btn-green" href="/#join">How to get access</Link>
          </aside>
        )}
      </main>
      <SiteFooter />
      <OnboardSheet />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { JobCard } from '@/components/job-card';
import { OnboardSheet } from '@/components/onboard-sheet';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine, must } from '@/lib/engine';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { FilterPanel } from './filter-panel';
import { activeCount, CATEGORIES, jobsHref, PAY, readFilters, TYPES, type Filters } from './filters';
import s from './jobs.module.css';

export const metadata: Metadata = { title: 'Remote jobs' };

type Search = Record<string, string | string[] | undefined>;

export default async function Jobs({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const f = readFilters(sp);
  const q = f.q;
  const pay = PAY.find(([k]) => k === f.pay);
  const cursor = typeof sp.cursor === 'string' ? sp.cursor : undefined;
  let page: { items?: Parameters<typeof JobCard>[0]['job'][]; next_cursor?: string | null } = {};
  let failed = false;
  try {
    const api = await engine();
    page = must(await api.GET('/jobs', {
      params: { query: {
        q, employment_type: f.types.length ? f.types : undefined, category: f.category, verified_only: f.verified || undefined,
        location: f.worldwide ? ['worldwide'] : undefined, ...(pay ? { min_pay_monthly: pay[3], currency: pay[2] } : {}), cursor, limit: 24,
      } },
    }));
  } catch {
    failed = true;
  }

  // Each active filter as a tag whose × removes just that one.
  const tags: { label: string; without: Filters }[] = [
    ...(f.category ? [{ label: CATEGORIES.find(([k]) => k === f.category)![1], without: { ...f, category: undefined } }] : []),
    ...f.types.map((t) => ({ label: TYPES.find(([k]) => k === t)![1], without: { ...f, types: f.types.filter((x) => x !== t) } })),
    ...(pay ? [{ label: `${pay[1]}+ a month`, without: { ...f, pay: undefined } }] : []),
    ...(f.worldwide ? [{ label: 'Open to anyone, anywhere', without: { ...f, worldwide: false } }] : []),
    ...(f.verified ? [{ label: 'Verified employers', without: { ...f, verified: false } }] : []),
  ];
  const items = page.items ?? [];

  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className="wrap">
        <header className={s.head}>
          <h1 className={s.h}>{q ? <>Jobs for &ldquo;{q}&rdquo;</> : 'Remote jobs you can actually get'}</h1>
          <div className={s.searchRow}>
            <form className={s.search} role="search" action="/jobs">
              <input className="input" type="search" name="q" defaultValue={q} placeholder="Search a role, skill or company" aria-label="Search jobs" />
              {f.category && <input type="hidden" name="category" value={f.category} />}
              {f.types.map((t) => <input key={t} type="hidden" name="type" value={t} />)}
              {f.worldwide && <input type="hidden" name="worldwide" value="1" />}
              {f.verified && <input type="hidden" name="verified" value="1" />}
              {f.pay && <input type="hidden" name="pay" value={f.pay} />}
              <button className={`btn btn-green ${s.searchBtn}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
                <span>Search</span>
              </button>
            </form>
            <FilterPanel f={f} count={activeCount(f)} />
          </div>
          {tags.length > 0 && (
            <ul className={s.tags} aria-label="Filters on">
              {tags.map((t) => (
                <li key={t.label}><Link href={jobsHref(t.without)} className={s.tag} aria-label={`Remove ${t.label}`}>{t.label} <span aria-hidden="true">×</span></Link></li>
              ))}
              {tags.length > 1 && <li><Link href={jobsHref({ q, types: [], worldwide: false, verified: false })} className={s.clear}>Clear all</Link></li>}
            </ul>
          )}
        </header>

        {failed ? (
          <p className={s.empty}>We couldn&rsquo;t load jobs just now. Try again in a minute.</p>
        ) : items.length === 0 ? (
          <p className={s.empty}>No jobs match that yet. Try fewer words or another filter.</p>
        ) : (
          <div className={s.grid}>{items.map((j) => <JobCard key={j.id} job={j} />)}</div>
        )}
        {page.next_cursor && (
          <p className={s.more}><Link className="btn btn-line" href={jobsHref(f, page.next_cursor)}>More jobs</Link></p>
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

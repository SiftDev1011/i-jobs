'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { JobCard, type JobSummary } from '@/components/job-card';
import { moreJobs } from './actions';
import type { JobsQuery } from './query';
import s from './jobs.module.css';

/**
 * The jobs grid. "More jobs" loads the next page in place; after that first click, the next pages load
 * by themselves as you near the end of the list. Without JavaScript the button is a plain link.
 */
export function JobFeed({ initial, next, query, moreHref }: { initial: JobSummary[]; next: string | null; query: JobsQuery; moreHref: string | null }) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(next);
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    const r = await moreJobs(query, cursor);
    if ('error' in r) {
      setError(r.error);
      setAuto(false); // stop retrying by itself; the button tries again
    } else {
      setItems((prev) => {
        const seen = new Set(prev.map((j) => j.id));
        return [...prev, ...r.items.filter((j) => !seen.has(j.id))];
      });
      setCursor(r.next_cursor);
      setSaid(`${r.items.length} more jobs loaded.`);
    }
    setLoading(false);
    busy.current = false;
  }, [cursor, query]);

  // After the first click, load the next page when the end of the list comes within a screen.
  useEffect(() => {
    if (!auto || !cursor || !sentinel.current) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && load(), { rootMargin: '900px 0px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [auto, cursor, load]);

  return (
    <>
      <div className={s.grid}>{items.map((j) => <JobCard key={j.id} job={j} />)}</div>
      <div ref={sentinel} aria-hidden="true" />
      <p className="sr-only" role="status">{said}</p>
      {cursor && (
        <div className={s.more}>
          {loading ? (
            <span className={s.spin} role="progressbar" aria-label="Loading more jobs" />
          ) : !auto ? (
            <Link
              className="btn btn-line"
              href={moreHref ?? '/jobs'}
              onClick={(e) => { e.preventDefault(); setAuto(true); load(); }}
            >
              {error ? 'Try again' : 'More jobs'}
            </Link>
          ) : null}
          {error && <p className={s.moreErr}>{error}</p>}
        </div>
      )}
      {!cursor && items.length > 24 && <p className={s.end}>That&rsquo;s every job for this search.</p>}
    </>
  );
}

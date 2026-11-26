'use server';

import { engine, must } from '@/lib/engine';
import type { JobSummary } from '@/components/job-card';
import { PAGE_SIZE, type JobsQuery } from './query';


/** The next page of the jobs list, for endless scroll. */
export async function moreJobs(query: JobsQuery, cursor: string): Promise<{ items: JobSummary[]; next_cursor: string | null } | { error: string }> {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 500) return { error: 'bad cursor' };
  try {
    const api = await engine();
    const page = must(await api.GET('/jobs', {
      params: { query: {
        q: query.q?.slice(0, 200) || undefined,
        employment_type: query.employment_type?.slice(0, 10) as never,
        category: query.category as never,
        verified_only: query.verified_only || undefined,
        location: query.location?.slice(0, 3) as never,
        ...(query.min_pay_monthly ? { min_pay_monthly: query.min_pay_monthly, currency: query.currency } : {}),
        cursor,
        limit: PAGE_SIZE,
      } },
    }));
    return { items: page.items ?? [], next_cursor: page.next_cursor ?? null };
  } catch {
    return { error: 'We couldn’t load more jobs just now.' };
  }
}

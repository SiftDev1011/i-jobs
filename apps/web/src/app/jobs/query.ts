/** The same search the jobs page ran, as plain values (what the page passes to the feed). */
export type JobsQuery = {
  q?: string;
  employment_type?: string[];
  category?: string;
  verified_only?: boolean;
  location?: string[];
  min_pay_monthly?: number;
  currency?: string;
};

/** Jobs per page, on first load and each time more load. */
export const PAGE_SIZE = 100;

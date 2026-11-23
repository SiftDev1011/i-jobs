/** The filters on /jobs, shared by the page (reading the address) and the panel (writing it). */
export const CATEGORIES = [
  ['customer-support', 'Customer support'], ['data', 'Data'], ['design', 'Design'], ['education', 'Education'],
  ['engineering', 'Engineering'], ['finance', 'Finance'], ['health', 'Health'], ['hr', 'HR and recruiting'],
  ['internships', 'Internships'], ['legal', 'Legal'], ['marketing', 'Marketing'], ['ngo', 'NGO and development'],
  ['operations', 'Operations'], ['product', 'Product'], ['sales', 'Sales'], ['writing', 'Writing'], ['other', 'Other'],
] as const;

export const TYPES = [
  ['full_time', 'Full time'], ['part_time', 'Part time'], ['contract', 'Contract'], ['freelance', 'Freelance'],
  ['internship', 'Internship'], ['graduate', 'Graduate'], ['temporary', 'Temporary'],
] as const;

/** "Pays at least, a month". Only jobs that show their pay in that currency match. Amounts in minor units. */
export const PAY = [
  ['usd500', 'US$500', 'USD', 50_000], ['usd1000', 'US$1,000', 'USD', 100_000], ['usd2000', 'US$2,000', 'USD', 200_000], ['usd4000', 'US$4,000', 'USD', 400_000],
  ['ngn300k', '₦300,000', 'NGN', 30_000_000], ['ngn500k', '₦500,000', 'NGN', 50_000_000], ['ngn1m', '₦1,000,000', 'NGN', 100_000_000],
] as const;

export type Category = (typeof CATEGORIES)[number][0];
export type JobType = (typeof TYPES)[number][0];
export type Pay = (typeof PAY)[number][0];

export type Filters = { q?: string; category?: Category; types: JobType[]; worldwide: boolean; verified: boolean; pay?: Pay };
type Raw = Record<string, string | string[] | undefined>;

const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export function readFilters(sp: Raw): Filters {
  const first = (k: string) => all(sp[k])[0];
  return {
    q: first('q')?.trim().slice(0, 120) || undefined,
    category: CATEGORIES.find(([k]) => k === first('category'))?.[0],
    types: TYPES.map(([k]) => k).filter((k) => all(sp.type).includes(k)),
    worldwide: first('worldwide') === '1',
    verified: first('verified') === '1',
    pay: PAY.find(([k]) => k === first('pay'))?.[0],
  };
}

/** The /jobs address for a set of filters (the panel's form produces the same shape). */
export function jobsHref(f: Filters, cursor?: string) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.category) p.set('category', f.category);
  for (const t of f.types) p.append('type', t);
  if (f.worldwide) p.set('worldwide', '1');
  if (f.verified) p.set('verified', '1');
  if (f.pay) p.set('pay', f.pay);
  if (cursor) p.set('cursor', cursor);
  const qs = p.toString();
  return `/jobs${qs ? `?${qs}` : ''}`;
}

export const activeCount = (f: Filters) => (f.category ? 1 : 0) + f.types.length + (f.worldwide ? 1 : 0) + (f.verified ? 1 : 0) + (f.pay ? 1 : 0);

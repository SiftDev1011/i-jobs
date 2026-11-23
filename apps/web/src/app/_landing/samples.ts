import type { JobSummary } from '@/components/job-card';

/** Sample cards for local development only (LANDING_SAMPLE_JOBS). Never shown in production. */
const raw: [string, string, string, JobSummary['location_scope'], string[], JobSummary['employment_type'], /* US cents a month */ number, JobSummary['trust'], NonNullable<JobSummary['badges']>][] = [
  ['Customer success associate', 'Kora Labs', 'a', 'worldwide', [], 'full_time', 120000, 'verified_employer', []],
  ['Junior data analyst', 'Tella', 'b', 'restricted', ['NG', 'GH', 'KE'], 'full_time', 90000, 'careers_page', ['new_today']],
  ['Operations coordinator', 'Sabi Logistics', 'c', 'restricted', ['NG'], 'contract', 105000, 'verified_employer', []],
  ['Programme assistant', 'Lumen Africa', 'd', 'restricted', ['NG', 'GH'], 'full_time', 140000, 'careers_page', ['closes_soon']],
  ['Junior product designer', 'Northwind Studio', 'e', 'worldwide', [], 'full_time', 130000, 'verified_employer', []],
  ['Content writer', 'Brightpath Health', 'f', 'worldwide', [], 'part_time', 70000, 'careers_page', ['new_today']],
  ['Support trainee', 'Paywise', 'g', 'restricted', ['NG'], 'graduate', 50000, 'careers_page', ['grad_friendly']],
  ['Data intern', 'Open Atlas', 'h', 'worldwide', [], 'internship', 40000, 'careers_page', ['internship']],
  ['Junior QA tester', 'Quillforge', 'i', 'worldwide', [], 'contract', 65000, 'careers_page', ['new_today']],
  ['Community moderator', 'Chatbase', 'j', 'restricted', ['NG', 'KE'], 'part_time', 55000, 'careers_page', ['closes_soon']],
  ['Video editor', 'Mavo Media', 'k', 'worldwide', [], 'freelance', 80000, 'careers_page', ['side_gig']],
  ['Bookkeeper', 'Halden Accounts', 'l', 'restricted', ['NG'], 'part_time', 60000, 'careers_page', ['side_gig']],
  ['Frontend developer', 'Zuripay', 'm', 'worldwide', [], 'full_time', 210000, 'verified_employer', []],
  ['Virtual assistant', 'Atlas Founders', 'n', 'worldwide', [], 'part_time', 45000, 'careers_page', ['side_gig']],
  ['Sales development rep', 'Gridsmith', 'o', 'restricted', ['NG', 'GH'], 'full_time', 95000, 'careers_page', ['new_today']],
  ['UX researcher', 'Ember Labs', 'p', 'worldwide', [], 'contract', 150000, 'verified_employer', []],
  ['Marketing intern', 'Remote Hustle', 'q', 'restricted', ['NG'], 'internship', 25000, 'careers_page', ['internship']],
  ['Design intern', '99 Studio', 'r', 'restricted', ['NG'], 'internship', 30000, 'careers_page', ['grad_friendly']],
];

export const SAMPLE_JOBS: JobSummary[] = raw.map(([title, company, id, scope, countries, type, usd, trust, badges]) => ({
  id: `00000000-0000-4000-8000-0000000000${id.charCodeAt(0).toString(16)}`,
  title, company_name: company, location_scope: scope, allowed_countries: countries, employment_type: type,
  pay: { min_minor: usd, max_minor: usd, currency: 'USD', period: 'month' }, trust, badges, source: {},
}));

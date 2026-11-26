/**
 * Remote job boards. Each has its own terms: credit, link back, and (for most) apply
 * through the board's own link. Those rules live on the source row; this file only reads data.
 */
import { payFromNumbers, payFromText } from '../normalise';
import { htmlToText, logoUrl, oneLine, safeUrl, toDate } from '../text';
import { cfg, Connector } from '../types';

// ------------------------------------------------------------------ Himalayas
// GET https://himalayas.app/jobs/api?limit=20&offset=N   (max 20 a page)
export const himalayas: Connector = {
  key: 'himalayas',
  async fetch({ http, source }) {
    const pages = cfg(source, 'pages', 5);
    const size = cfg(source, 'page_size', 20);
    const items = [];
    for (let p = 0; p < pages; p++) {
      const res = await http.json(`https://himalayas.app/jobs/api?limit=${size}&offset=${p * size}`);
      const jobs = res.jobs ?? [];
      items.push(...jobs.map((j: any) => ({ externalId: String(j.guid ?? j.applicationLink), url: j.guid, payload: j })));
      if (jobs.length < size) break;
    }
    return { items, complete: false };
  },
  normalise(j) {
    return {
      title: oneLine(j.title, 200),
      company: oneLine(j.companyName, 120),
      companyLogo: logoUrl(j.companyLogo),
      description: htmlToText(j.description) || oneLine(j.excerpt, 2000),
      sourceUrl: safeUrl(j.guid),
      // Their terms: Apply must use applicationLink.
      applyUrl: safeUrl(j.applicationLink ?? j.guid),
      location: {
        remote: true,
        texts: (j.locationRestrictions ?? []).length ? [] : ['Worldwide'],
        countries: j.locationRestrictions ?? [],
        tzOffsets: (j.timezoneRestrictions ?? []).map(Number),
      },
      employmentHints: [j.employmentType],
      seniorityHint: j.seniority,
      pay: payFromNumbers(j.minSalary, j.maxSalary, j.currency ?? j.salaryCurrency ?? 'USD', 'year'),
      postedAt: toDate(j.pubDate),
      deadline: toDate(j.expiryDate),
      labels: [...(j.categories ?? []), ...(j.parentCategories ?? [])],
    };
  },
};

// ------------------------------------------------------------------ Jobicy
// GET https://jobicy.com/api/v2/remote-jobs?count=100
export const jobicy: Connector = {
  key: 'jobicy',
  async fetch({ http, source }) {
    const res = await http.json(`https://jobicy.com/api/v2/remote-jobs?count=${cfg(source, 'count', 100)}`);
    return { items: (res.jobs ?? []).map((j: any) => ({ externalId: String(j.id), url: j.url, payload: j })), complete: false };
  },
  normalise(j) {
    const geo = String(j.jobGeo ?? '');
    return {
      title: oneLine(j.jobTitle, 200),
      company: oneLine(j.companyName, 120),
      companyLogo: logoUrl(j.companyLogo),
      description: htmlToText(j.jobDescription) || oneLine(j.jobExcerpt, 2000),
      sourceUrl: safeUrl(j.url),
      applyUrl: safeUrl(j.url),
      location: { remote: true, texts: [/anywhere/i.test(geo) ? 'Worldwide' : geo] },
      employmentHints: [].concat(j.jobType ?? []),
      seniorityHint: j.jobLevel,
      pay: payFromNumbers(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency, 'year'),
      postedAt: toDate(j.pubDate),
      labels: [].concat(j.jobIndustry ?? []),
    };
  },
};

// ------------------------------------------------------------------ Remote OK
// GET https://remoteok.com/api   (first element is their legal notice)
export const remoteok: Connector = {
  key: 'remoteok',
  async fetch({ http }) {
    const res = await http.json<any[]>('https://remoteok.com/api');
    const jobs = res.filter((x) => x && x.id && x.position);
    return { items: jobs.map((j) => ({ externalId: String(j.id), url: j.url, payload: j })), complete: false };
  },
  normalise(j) {
    return {
      title: oneLine(j.position, 200),
      company: oneLine(j.company, 120),
      companyLogo: logoUrl(j.company_logo) ?? logoUrl(j.logo),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.url),
      applyUrl: safeUrl(j.url),
      location: { remote: true, texts: [j.location || 'Worldwide'] },
      pay: payFromNumbers(j.salary_min, j.salary_max, 'USD', 'year'),
      postedAt: toDate(j.epoch) ?? toDate(j.date),
      labels: j.tags ?? [],
      skills: (j.tags ?? []).slice(0, 12),
    };
  },
};

// ------------------------------------------------------------------ Remotive
// GET https://remotive.com/api/remote-jobs?limit=N   (at most 4 calls a day)
export const remotive: Connector = {
  key: 'remotive',
  async fetch({ http, source }) {
    const limit = cfg(source, 'limit', 300);
    const res = await http.json(`https://remotive.com/api/remote-jobs?limit=${limit}`);
    const jobs = res.jobs ?? [];
    return { items: jobs.map((j: any) => ({ externalId: String(j.id), url: j.url, payload: j })), complete: jobs.length < limit };
  },
  normalise(j) {
    return {
      title: oneLine(j.title, 200),
      company: oneLine(j.company_name, 120),
      companyLogo: logoUrl(j.company_logo) ?? logoUrl(j.company_logo_url),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.url),
      applyUrl: safeUrl(j.url),
      location: { remote: true, texts: [j.candidate_required_location || 'Worldwide'] },
      employmentHints: [j.job_type],
      pay: payFromText(j.salary),
      postedAt: toDate(j.publication_date && !/[zZ+]/.test(j.publication_date.slice(10)) ? `${j.publication_date}Z` : j.publication_date),
      labels: [j.category, ...(j.tags ?? [])],
    };
  },
};

// ------------------------------------------------------------------ We Work Remotely (RSS)
// GET https://weworkremotely.com/remote-jobs.rss
export const weworkremotely: Connector = {
  key: 'weworkremotely',
  async fetch({ http }) {
    const doc = await http.xml('https://weworkremotely.com/remote-jobs.rss');
    const items = doc?.rss?.channel?.item ?? [];
    return { items: items.map((i: any) => ({ externalId: String(i.guid?.['#text'] ?? i.guid ?? i.link), url: i.link, payload: i })), complete: false };
  },
  normalise(i) {
    // Titles look like "Company: Job title".
    const raw = oneLine(i.title, 300);
    const cut = raw.indexOf(': ');
    const [company, title] = cut > 0 ? [raw.slice(0, cut), raw.slice(cut + 2)] : ['Unknown company', raw];
    return {
      title: oneLine(title, 200),
      company: oneLine(company, 120),
      description: htmlToText(i.description),
      sourceUrl: safeUrl(i.link),
      applyUrl: safeUrl(i.link),
      location: { remote: true, texts: [i.region, i.country].filter(Boolean) },
      employmentHints: [i.type],
      postedAt: toDate(i.pubDate),
      labels: [i.category],
    };
  },
};

// ------------------------------------------------------------------ Working Nomads
// GET https://www.workingnomads.com/api/exposed_jobs/
export const workingnomads: Connector = {
  key: 'workingnomads',
  async fetch({ http }) {
    const res = await http.json<any[]>('https://www.workingnomads.com/api/exposed_jobs/');
    return { items: res.map((j) => ({ externalId: String(j.url), url: j.url, payload: j })), complete: false };
  },
  normalise(j) {
    return {
      title: oneLine(j.title, 200),
      company: oneLine(j.company_name, 120),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.url),
      applyUrl: safeUrl(j.url),
      location: { remote: true, texts: [j.location || 'Worldwide'] },
      postedAt: toDate(j.pub_date),
      labels: [j.category_name, ...String(j.tags ?? '').split(',')],
      skills: String(j.tags ?? '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 12),
    };
  },
};

// ------------------------------------------------------------------ Get on Board (Latin America)
// GET https://www.getonbrd.com/api/v0/categories/{category}/jobs?per_page=50&page=N&expand=["company"]
// Their terms: only remote jobs that are open outside Latin America.
export const getonboard: Connector = {
  key: 'getonboard',
  async fetch({ http, source }) {
    const cats = cfg<string[]>(source, 'categories', ['programming']);
    const perPage = cfg(source, 'per_page', 50);
    const items = [];
    for (const cat of cats) {
      const res = await http.json(`https://www.getonbrd.com/api/v0/categories/${encodeURIComponent(cat)}/jobs?per_page=${perPage}&page=1&expand=${encodeURIComponent('["company"]')}`);
      items.push(...(res.data ?? []).map((j: any) => ({ externalId: String(j.id), url: j.links?.public_url, payload: j })));
    }
    return { items, complete: false };
  },
  normalise(j) {
    const a = j.attributes ?? {};
    const modality = String(a.remote_modality ?? '');
    if (!a.remote || modality !== 'fully_remote') return { skip: 'getonboard_not_fully_remote' };
    // A country list means it's limited to those (Latin American) countries.
    if ((a.countries ?? []).length) return { skip: 'getonboard_country_limited' };
    return {
      title: oneLine(a.title, 200),
      company: oneLine(a.company?.data?.attributes?.name ?? 'Unknown company', 120),
      companyLogo: logoUrl(a.company?.data?.attributes?.logo),
      description: [a.description, a.projects, a.functions, a.desirable, a.benefits].map(htmlToText).filter(Boolean).join('\n\n'),
      sourceUrl: safeUrl(j.links?.public_url),
      applyUrl: safeUrl(j.links?.public_url),
      location: { remote: true, texts: [a.remote_zone || 'Worldwide'] },
      employmentHints: [a.modality?.data?.id ?? a.modality],
      seniorityHint: a.seniority?.data?.id ? String(a.seniority.data.id) : null,
      pay: payFromNumbers(a.min_salary, a.max_salary, 'USD', 'month'),
      postedAt: toDate(a.published_at),
      labels: [a.category_name],
    };
  },
};

export const boardConnectors = [himalayas, jobicy, remoteok, remotive, weworkremotely, workingnomads, getonboard];

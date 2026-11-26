/**
 * Aggregators, NGO listings and paid providers: searches, not full listings, so jobs
 * close through expiry and link checks rather than by vanishing from a feed.
 */
import { countryCode } from '../location';
import { payFromNumbers, payFromText } from '../normalise';
import { hostOf, htmlToText, logoUrl, oneLine, safeUrl, toDate } from '../text';
import { cfg, Connector, ConnectorUnavailable } from '../types';

const enc = encodeURIComponent;

// ------------------------------------------------------------------ Adzuna
// GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id&app_key&results_per_page&what
export const adzuna: Connector = {
  key: 'adzuna',
  missingCredentials: (c) => (c.ADZUNA_APP_ID && c.ADZUNA_APP_KEY ? null : 'Set ADZUNA_APP_ID and ADZUNA_APP_KEY'),
  async fetch({ http, source, config }) {
    const countries = cfg<string[]>(source, 'countries', ['gb']);
    const pages = cfg(source, 'pages', 1);
    const per = cfg(source, 'results_per_page', 50);
    const what = cfg(source, 'what', 'remote');
    const maxDays = cfg(source, 'max_days_old', 3);
    const items = [];
    for (const country of countries) {
      for (let page = 1; page <= pages; page++) {
        const url = `https://api.adzuna.com/v1/api/jobs/${enc(country)}/search/${page}?app_id=${enc(config.ADZUNA_APP_ID!)}&app_key=${enc(config.ADZUNA_APP_KEY!)}&results_per_page=${per}&what=${enc(what)}&max_days_old=${maxDays}&sort_by=date&content-type=application/json`;
        const res = await http.json(url);
        const results = res.results ?? [];
        items.push(...results.map((j: any) => ({ externalId: String(j.id), url: j.redirect_url, payload: { ...j, _country: country } })));
        if (results.length < per) break;
      }
    }
    return { items, complete: false };
  },
  normalise(j) {
    const text = `${j.title} ${j.description}`;
    return {
      title: oneLine(htmlToText(j.title), 200),
      company: oneLine(j.company?.display_name ?? 'Unknown company', 120),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.redirect_url),
      // Their terms: clicks go through redirect_url.
      applyUrl: safeUrl(j.redirect_url),
      location: {
        texts: [j.location?.display_name, ...(j.location?.area ?? []), /\bremote\b/i.test(text) ? 'Remote' : null],
        countries: [String(j._country ?? '').toUpperCase() === 'GB' ? 'GB' : String(j._country ?? '').toUpperCase()],
      },
      employmentHints: [j.contract_time, j.contract_type],
      pay: j.salary_is_predicted === '1' || j.salary_is_predicted === 1 ? null : payFromNumbers(j.salary_min, j.salary_max, currencyFor(j._country), 'year'),
      postedAt: toDate(j.created),
      labels: [j.category?.label],
    };
  },
};

function currencyFor(country: string): string {
  return ({ gb: 'GBP', us: 'USD', za: 'ZAR', in: 'INR', ca: 'CAD', au: 'AUD', de: 'EUR', fr: 'EUR', nl: 'EUR', br: 'BRL', sg: 'SGD', pl: 'PLN', mx: 'MXN' } as Record<string, string>)[country] ?? 'USD';
}

// ------------------------------------------------------------------ Careerjet
// Partner search API. With CAREERJET_API_KEY: the v4 endpoint with basic auth; otherwise the
// classic public endpoint with an affiliate id. Same response shape. Check with source:try first.
export const careerjet: Connector = {
  key: 'careerjet',
  missingCredentials: (c) => (c.CAREERJET_API_KEY || c.CAREERJET_AFFID ? null : 'Set CAREERJET_API_KEY or CAREERJET_AFFID'),
  async fetch({ http, source, config }) {
    const locales = cfg<string[]>(source, 'locales', ['en_NG']);
    const pages = cfg(source, 'pages', 1);
    const size = cfg(source, 'page_size', 99);
    const keywords = cfg(source, 'keywords', '');
    const items = [];
    for (const locale of locales) {
      for (let page = 1; page <= pages; page++) {
        const q = `locale_code=${enc(locale)}&keywords=${enc(keywords)}&sort=date&pagesize=${size}&page=${page}&user_ip=127.0.0.1&user_agent=${enc(config.INGEST_USER_AGENT)}`;
        const res = config.CAREERJET_API_KEY
          ? await http.json(`https://search.api.careerjet.net/v4/query?${q}`, {
              headers: { Authorization: `Basic ${Buffer.from(`${config.CAREERJET_API_KEY}:`).toString('base64')}` },
            })
          : await http.json(`https://public.api.careerjet.net/search?${q}&affid=${enc(config.CAREERJET_AFFID!)}`);
        if (res.type && res.type !== 'JOBS') break;
        const jobs = res.jobs ?? [];
        items.push(...jobs.map((j: any) => ({ externalId: String(j.url), url: j.url, payload: { ...j, _locale: locale } })));
        if (jobs.length < size) break;
      }
    }
    return { items, complete: false };
  },
  normalise(j) {
    const country = String(j._locale ?? '').split('_')[1];
    return {
      title: oneLine(htmlToText(j.title), 200),
      company: oneLine(j.company || hostOf(j.site) || 'Unknown company', 120),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.url),
      applyUrl: safeUrl(j.url),
      location: { texts: [j.locations, /\bremote\b/i.test(`${j.title} ${j.description}`) ? 'Remote' : null], countries: [country] },
      pay: j.salary_min || j.salary_max
        ? payFromNumbers(j.salary_min, j.salary_max, j.salary_currency_code, ({ Y: 'year', M: 'month', W: 'week', D: 'day', H: 'hour' } as Record<string, string>)[j.salary_type] ?? null)
        : payFromText(j.salary),
      postedAt: toDate(j.date),
    };
  },
};

// ------------------------------------------------------------------ Jooble
// POST https://jooble.org/api/{key}  { keywords, location, page, ResultOnPage }
export const jooble: Connector = {
  key: 'jooble',
  missingCredentials: (c) => (c.JOOBLE_API_KEY ? null : 'Set JOOBLE_API_KEY'),
  async fetch({ http, source, config }) {
    const searches = cfg<{ keywords: string; location: string }[]>(source, 'searches', [{ keywords: 'remote', location: '' }]);
    const per = cfg(source, 'per_page', 50);
    const pages = cfg(source, 'pages', 1);
    const items = [];
    for (const s of searches) {
      for (let page = 1; page <= pages; page++) {
        const res = await http.json(`https://jooble.org/api/${enc(config.JOOBLE_API_KEY!)}`, {
          json: { keywords: s.keywords, location: s.location, page: String(page), ResultOnPage: String(per) },
        });
        const jobs = res.jobs ?? [];
        items.push(...jobs.map((j: any) => ({ externalId: String(j.id), url: j.link, payload: { ...j, _search: s } })));
        if (jobs.length < per) break;
      }
    }
    return { items, complete: false };
  },
  normalise(j) {
    const text = `${j.title} ${j.snippet} ${j.location}`;
    return {
      title: oneLine(htmlToText(j.title), 200),
      company: oneLine(j.company || 'Unknown company', 120),
      description: htmlToText(j.snippet),
      sourceUrl: safeUrl(j.link),
      applyUrl: safeUrl(j.link),
      location: { texts: [j.location, /\bremote\b/i.test(text) ? 'Remote' : null], countries: [countryCode(j._search?.location)] },
      employmentHints: [j.type],
      pay: payFromText(j.salary),
      postedAt: toDate(j.updated),
    };
  },
};

// ------------------------------------------------------------------ Talent.com
// Publisher feed only after approval; their format comes with the approval.
export const talent: Connector = {
  key: 'talent',
  async fetch() {
    throw new ConnectorUnavailable('Talent.com needs publisher approval; add the connector once their feed details arrive.');
  },
  normalise() {
    return { skip: 'talent_not_available' };
  },
};

// ------------------------------------------------------------------ ReliefWeb (NGO and UN jobs)
// POST {api_base}/jobs?appname={approved name}
export const reliefweb: Connector = {
  key: 'reliefweb',
  missingCredentials: (c) => (c.RELIEFWEB_APPNAME ? null : 'Set RELIEFWEB_APPNAME (pre-approved by ReliefWeb)'),
  async fetch({ http, source, config }) {
    const base = cfg(source, 'api_base', 'https://api.reliefweb.int/v2');
    const iso3 = cfg<string[]>(source, 'countries_iso3', ['NGA']);
    const res = await http.json(`${base}/jobs?appname=${enc(config.RELIEFWEB_APPNAME!)}`, {
      json: {
        limit: cfg(source, 'limit', 100),
        profile: 'full',
        sort: ['date.created:desc'],
        filter: { field: 'country.iso3', value: iso3, operator: 'OR' },
      },
    });
    return { items: (res.data ?? []).map((d: any) => ({ externalId: String(d.id), url: d.fields?.url_alias ?? d.fields?.url, payload: d.fields ?? {} })), complete: false };
  },
  normalise(f) {
    const body = f['body-html'] ? htmlToText(f['body-html']) : String(f.body ?? '');
    const how = f['how_to_apply-html'] ? htmlToText(f['how_to_apply-html']) : String(f.how_to_apply ?? '');
    const org = (f.source ?? [])[0];
    const page = safeUrl(f.url_alias ?? f.url);
    return {
      title: oneLine(f.title, 200),
      company: oneLine(org?.name ?? org?.shortname ?? 'Unknown organisation', 120),
      companyDomain: hostOf(org?.homepage),
      description: [body, how && `How to apply\n${how}`].filter(Boolean).join('\n\n'),
      sourceUrl: page,
      applyUrl: page,
      location: {
        texts: [...(f.city ?? []).map((c: any) => c.name), /\b(home[- ]based|remote)\b/i.test(`${f.title} ${body}`) ? 'Remote' : null],
        countries: (f.country ?? []).map((c: any) => c.iso3),
      },
      employmentHints: (f.type ?? []).map((t: any) => t.name),
      seniorityHint: (f.experience ?? []).map((e: any) => e.name),
      postedAt: toDate(f.date?.created),
      deadline: toDate(f.date?.closing),
      labels: (f.career_categories ?? []).map((c: any) => c.name),
    };
  },
};

// ------------------------------------------------------------------ TheirStack
// POST https://api.theirstack.com/v1/jobs/search   (Bearer key; 1 credit a job, so small slices)
export const theirstack: Connector = {
  key: 'theirstack',
  missingCredentials: (c) => (c.THEIRSTACK_API_KEY ? null : 'Set THEIRSTACK_API_KEY'),
  async fetch({ http, source, config }) {
    const res = await http.json('https://api.theirstack.com/v1/jobs/search', {
      headers: { Authorization: `Bearer ${config.THEIRSTACK_API_KEY}` },
      json: {
        page: 0,
        limit: cfg(source, 'limit', 6),
        posted_at_max_age_days: cfg(source, 'posted_at_max_age_days', 2),
        remote: cfg(source, 'remote', true),
        ...(cfg<string[] | null>(source, 'job_country_code_or', null) ? { job_country_code_or: cfg(source, 'job_country_code_or', []) } : {}),
        include_total_results: false,
      },
    });
    return { items: (res.data ?? []).map((j: any) => ({ externalId: String(j.id), url: j.final_url ?? j.url, payload: j })), complete: false };
  },
  normalise(j) {
    const company = j.company_object?.name ?? j.company ?? 'Unknown company';
    return {
      title: oneLine(j.job_title, 200),
      company: oneLine(company, 120),
      companyDomain: j.company_object?.domain ?? j.company_domain ?? null,
      companyLogo: logoUrl(j.company_object?.logo),
      description: htmlToText(j.description) || String(j.description ?? ''),
      sourceUrl: safeUrl(j.final_url ?? j.url),
      applyUrl: safeUrl(j.final_url ?? j.url),
      location: {
        texts: [j.location, j.short_location],
        remote: j.remote === true ? true : j.hybrid === true ? false : null,
        workplace: j.hybrid === true ? 'hybrid' : null,
        countries: [j.country_code, ...(j.country_codes ?? [])],
      },
      employmentHints: j.employment_statuses ?? [],
      seniorityHint: j.seniority,
      pay: j.min_annual_salary_usd || j.max_annual_salary_usd
        ? payFromNumbers(j.min_annual_salary_usd, j.max_annual_salary_usd, 'USD', 'year')
        : payFromText(j.salary_string),
      postedAt: toDate(j.date_posted),
      skills: (j.technology_slugs ?? []).slice(0, 12),
      // Their jobs come from many boards; our terms say drop LinkedIn and Indeed ones.
      originHosts: [j.url, j.final_url, j.source_url].map(hostOf).filter((h): h is string => !!h),
    };
  },
};

export const aggregatorConnectors = [adzuna, careerjet, jooble, talent, reliefweb, theirstack];

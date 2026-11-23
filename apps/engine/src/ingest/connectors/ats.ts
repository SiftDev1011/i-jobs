/**
 * Applicant systems: each company has its own public board. Fetched once per board
 * (source_boards). These are the employer's own listings, so they carry careers-page trust.
 */
import { countryCode } from '../location';
import { payFromNumbers, payFromText, payPeriod } from '../normalise';
import { htmlToText, oneLine, safeUrl, tidy, toDate } from '../text';
import { BoardRow, Connector, FetchContext } from '../types';

const enc = encodeURIComponent;
const companyOf = (board: BoardRow | null, fallback?: string | null) =>
  oneLine(board?.company_name || fallback || board?.board_token || 'Unknown company', 120);

// ------------------------------------------------------------------ Greenhouse
// GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
export const greenhouse: Connector = {
  key: 'greenhouse',
  perBoard: true,
  async fetch({ http, board }) {
    const res = await http.json(`https://boards-api.greenhouse.io/v1/boards/${enc(board!.board_token)}/jobs?content=true`);
    return { items: (res.jobs ?? []).map((j: any) => ({ externalId: String(j.id), url: j.absolute_url, payload: j })), complete: true };
  },
  normalise(j, { board }) {
    const offices = (j.offices ?? []).map((o: any) => o.location || o.name);
    return {
      title: oneLine(j.title, 200),
      company: companyOf(board, j.company_name),
      description: htmlToText(j.content),
      sourceUrl: safeUrl(j.absolute_url),
      applyUrl: safeUrl(j.absolute_url),
      location: { texts: [j.location?.name, ...offices] },
      employmentHints: (j.metadata ?? []).filter((m: any) => /employment|type/i.test(m.name ?? '')).map((m: any) => String(m.value ?? '')),
      postedAt: toDate(j.first_published) ?? toDate(j.updated_at),
      labels: (j.departments ?? []).map((d: any) => d.name),
    };
  },
};

// ------------------------------------------------------------------ Lever
// GET https://api.lever.co/v0/postings/{site}?mode=json   (EU accounts: board token "eu:{site}")
export const lever: Connector = {
  key: 'lever',
  perBoard: true,
  async fetch({ http, board }) {
    const [host, site] = board!.board_token.startsWith('eu:')
      ? ['https://api.eu.lever.co', board!.board_token.slice(3)]
      : ['https://api.lever.co', board!.board_token];
    const res = await http.json<any[]>(`${host}/v0/postings/${enc(site)}?mode=json`);
    return { items: res.map((p) => ({ externalId: p.id, url: p.hostedUrl, payload: p })), complete: true };
  },
  normalise(p, { board }) {
    const lists = (p.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
    const desc = tidy([p.descriptionPlain ?? htmlToText(p.description), lists, p.additionalPlain ?? htmlToText(p.additional)].filter(Boolean).join('\n\n'));
    const sr = p.salaryRange;
    const interval = String(sr?.interval ?? '');
    return {
      title: oneLine(p.text, 200),
      company: companyOf(board),
      description: desc,
      sourceUrl: safeUrl(p.hostedUrl),
      applyUrl: safeUrl(p.applyUrl ?? p.hostedUrl),
      location: {
        texts: [p.categories?.location, ...(p.categories?.allLocations ?? [])],
        workplace: p.workplaceType === 'remote' ? 'remote' : p.workplaceType === 'hybrid' ? 'hybrid' : p.workplaceType === 'onsite' ? 'onsite' : null,
        countries: [p.country],
      },
      employmentHints: [p.categories?.commitment],
      pay: sr ? payFromNumbers(sr.min, sr.max, sr.currency, interval.includes('hour') ? 'hour' : interval.includes('month') ? 'month' : 'year') : null,
      postedAt: toDate(p.createdAt),
      labels: [p.categories?.department, p.categories?.team],
    };
  },
};

// ------------------------------------------------------------------ Ashby
// GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
export const ashby: Connector = {
  key: 'ashby',
  perBoard: true,
  async fetch({ http, board }) {
    const res = await http.json(`https://api.ashbyhq.com/posting-api/job-board/${enc(board!.board_token)}?includeCompensation=true`);
    const jobs = (res.jobs ?? []).filter((j: any) => j.isListed !== false);
    return { items: jobs.map((j: any) => ({ externalId: j.id, url: j.jobUrl, payload: j })), complete: true };
  },
  normalise(j, { board }) {
    const salary = (j.compensation?.summaryComponents ?? []).find((c: any) => c.compensationType === 'Salary');
    const wp = String(j.workplaceType ?? '').toLowerCase();
    return {
      title: oneLine(j.title, 200),
      company: companyOf(board),
      description: j.descriptionPlain ? tidy(j.descriptionPlain) : htmlToText(j.descriptionHtml),
      sourceUrl: safeUrl(j.jobUrl),
      applyUrl: safeUrl(j.applyUrl ?? j.jobUrl),
      location: {
        texts: [j.location, ...(j.secondaryLocations ?? []).map((s: any) => s.location)],
        remote: typeof j.isRemote === 'boolean' ? j.isRemote : null,
        workplace: wp === 'remote' ? 'remote' : wp === 'hybrid' ? 'hybrid' : wp === 'onsite' ? 'onsite' : null,
        countries: [j.address?.postalAddress?.addressCountry],
      },
      employmentHints: [j.employmentType],
      pay: salary ? payFromNumbers(salary.minValue, salary.maxValue, salary.currencyCode, payPeriod(String(salary.interval ?? '').replace(/^1\s*/, ''))) : null,
      postedAt: toDate(j.publishedAt),
      labels: [j.department, j.team],
    };
  },
};

// ------------------------------------------------------------------ BambooHR
// List: https://{company}.bamboohr.com/careers/list   Detail: /careers/{id}/detail
export const bamboohr: Connector = {
  key: 'bamboohr',
  perBoard: true,
  async fetch({ http, board, known }) {
    const base = `https://${enc(board!.board_token)}.bamboohr.com/careers`;
    const list = await http.json(`${base}/list`);
    const items = [];
    let details = 0;
    for (const j of list.result ?? []) {
      const id = String(j.id);
      if (known.has(id) || details >= 50) {
        items.push({ externalId: id, payload: j, touchOnly: true });
        continue;
      }
      details++;
      const d = await http.json(`${base}/${enc(id)}/detail`);
      items.push({ externalId: id, url: `${base}/${id}`, payload: { ...j, ...d.result?.jobOpening, _url: `${base}/${id}` } });
    }
    return { items, complete: true };
  },
  normalise(j, { board }) {
    const lt = String(j.locationType ?? '');
    return {
      title: oneLine(j.jobOpeningName, 200),
      company: companyOf(board),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.jobOpeningShareUrl ?? j._url),
      applyUrl: safeUrl(j.jobOpeningShareUrl ?? j._url),
      location: {
        texts: [[j.location?.city, j.location?.state].filter(Boolean).join(', '), j.atsLocation?.city, j.atsLocation?.country],
        remote: j.isRemote === true || lt === '1' ? true : null,
        workplace: lt === '2' ? 'hybrid' : lt === '0' && j.isRemote !== true ? 'onsite' : null,
        countries: [j.atsLocation?.country],
      },
      employmentHints: [j.employmentStatusLabel],
      pay: j.compensation ? payFromText(j.compensation) : null,
      postedAt: toDate(j.datePosted),
      labels: [j.departmentLabel],
    };
  },
};

// ------------------------------------------------------------------ Gupy (Brazil)
// GET https://portal.api.gupy.io/api/v1/jobs?careerPageName={name}&limit=100&offset=N
// Shape checked against the public portal; run `npm run source:try gupy <name>` before enabling boards.
export const gupy: Connector = {
  key: 'gupy',
  perBoard: true,
  async fetch({ http, board }) {
    const items = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const res = await http.json(`https://portal.api.gupy.io/api/v1/jobs?careerPageName=${enc(board!.board_token)}&limit=100&offset=${offset}`);
      const all: any[] = res.data ?? [];
      // Keep only this company's jobs, even if the portal ever ignores the filter.
      const token = board!.board_token.toLowerCase();
      const mine = all.filter((j) => String(j.careerPageName ?? '').toLowerCase() === token || String(j.careerPageUrl ?? j.jobUrl ?? '').toLowerCase().includes(`//${token}.gupy.io`));
      items.push(...mine.map((j: any) => ({ externalId: String(j.id), url: j.jobUrl, payload: j })));
      if (all.length < 100) break;
    }
    return { items, complete: true };
  },
  normalise(j, { board }) {
    const wp = String(j.workplaceType ?? '').toLowerCase();
    return {
      title: oneLine(j.name, 200),
      company: companyOf(board, j.careerPageName),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.jobUrl),
      applyUrl: safeUrl(j.jobUrl),
      location: {
        texts: [[j.city, j.state, j.country].filter(Boolean).join(', ')],
        remote: j.isRemoteWork === true ? true : null,
        workplace: wp === 'remote' ? 'remote' : wp === 'hybrid' ? 'hybrid' : wp === 'on-site' ? 'onsite' : null,
        countries: [j.country === 'Brasil' ? 'BR' : j.country],
      },
      employmentHints: [String(j.type ?? '').replace(/^vacancy_type_/, '')],
      postedAt: toDate(j.publishedDate),
      deadline: toDate(j.applicationDeadline),
    };
  },
};

// ------------------------------------------------------------------ Personio (XML)
// GET https://{company}.jobs.personio.de/xml   (or a full host as the board token, e.g. acme.jobs.personio.com)
export const personio: Connector = {
  key: 'personio',
  perBoard: true,
  async fetch({ http, board }) {
    const token = board!.board_token;
    const host = token.includes('.') ? token : `${token}.jobs.personio.de`;
    const doc = await http.xml(`https://${host}/xml?language=en`);
    const positions = doc?.['workzag-jobs']?.position ?? [];
    return {
      items: positions.map((p: any) => ({ externalId: String(p.id), url: `https://${host}/job/${p.id}`, payload: { ...p, _url: `https://${host}/job/${p.id}` } })),
      complete: true,
    };
  },
  normalise(p, { board }) {
    const sections = (p.jobDescriptions?.jobDescription ?? []).map((d: any) => `${d.name}\n${htmlToText(d.value)}`);
    return {
      title: oneLine(p.name, 200),
      company: companyOf(board, p.subcompany),
      description: tidy(sections.join('\n\n')),
      sourceUrl: safeUrl(p._url),
      applyUrl: safeUrl(p._url),
      location: { texts: [p.office, ...(p.additionalOffices?.office ? [].concat(p.additionalOffices.office) : [])] },
      employmentHints: [p.employmentType, p.schedule],
      seniorityHint: p.seniority,
      postedAt: toDate(p.createdAt),
      labels: [p.department, p.recruitingCategory, p.occupationCategory],
    };
  },
};

// ------------------------------------------------------------------ Recruitee
// GET https://{company}.recruitee.com/api/offers/
export const recruitee: Connector = {
  key: 'recruitee',
  perBoard: true,
  async fetch({ http, board }) {
    const res = await http.json(`https://${enc(board!.board_token)}.recruitee.com/api/offers/`);
    const offers = (res.offers ?? []).filter((o: any) => !o.status || o.status === 'published');
    return { items: offers.map((o: any) => ({ externalId: String(o.id), url: o.careers_url, payload: o })), complete: true };
  },
  normalise(o, { board }) {
    const s = o.salary ?? {};
    return {
      title: oneLine(o.title, 200),
      company: companyOf(board, o.company_name),
      description: tidy(`${htmlToText(o.description)}\n\n${htmlToText(o.requirements)}`),
      sourceUrl: safeUrl(o.careers_url),
      applyUrl: safeUrl(o.careers_apply_url ?? o.careers_url),
      location: {
        texts: [o.location, [o.city, o.country].filter(Boolean).join(', ')],
        remote: typeof o.remote === 'boolean' ? o.remote : null,
        workplace: o.hybrid === true ? 'hybrid' : o.on_site === true && o.remote !== true ? 'onsite' : null,
        countries: [o.country_code],
      },
      employmentHints: [o.employment_type_code],
      seniorityHint: o.experience_code,
      pay: s.min || s.max ? payFromNumbers(s.min, s.max, s.currency, s.period) : null,
      postedAt: toDate(o.published_at ?? o.created_at),
      deadline: toDate(o.close_at),
      labels: [o.department, o.category_code],
    };
  },
};

// ------------------------------------------------------------------ Teamtailor (RSS)
// GET https://{company}.teamtailor.com/jobs.rss
export const teamtailor: Connector = {
  key: 'teamtailor',
  perBoard: true,
  async fetch({ http, board }) {
    const doc = await http.xml(`https://${enc(board!.board_token)}.teamtailor.com/jobs.rss`);
    const items = doc?.rss?.channel?.item ?? [];
    return { items: items.map((i: any) => ({ externalId: String(i.guid?.['#text'] ?? i.guid ?? i.link), url: i.link, payload: i })), complete: true };
  },
  normalise(i, { board }) {
    const locs = [].concat(i.locations?.location ?? []).map((l: any) => [l.city, l.country].filter(Boolean).join(', '));
    const remote = String(i.remoteStatus ?? '').toLowerCase();
    return {
      title: oneLine(i.title, 200),
      company: companyOf(board),
      description: htmlToText(i.description),
      sourceUrl: safeUrl(i.link),
      applyUrl: safeUrl(i.link),
      location: {
        texts: locs,
        workplace: remote === 'fully' ? 'remote' : remote === 'hybrid' ? 'hybrid' : remote === 'none' ? 'onsite' : null,
        countries: [].concat(i.locations?.location ?? []).map((l: any) => l.country),
      },
      postedAt: toDate(i.pubDate),
      labels: [i.department, i.role],
    };
  },
};

// ------------------------------------------------------------------ Workable
// GET https://apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true
export const workable: Connector = {
  key: 'workable',
  perBoard: true,
  async fetch({ http, board }) {
    const res = await http.json(`https://apply.workable.com/api/v1/widget/accounts/${enc(board!.board_token)}?details=true`);
    const company = res.name;
    return {
      items: (res.jobs ?? []).map((j: any) => ({ externalId: String(j.shortcode), url: j.url ?? j.shortlink, payload: { ...j, _company: company } })),
      complete: true,
    };
  },
  normalise(j, { board }) {
    const locs = (j.locations ?? []).map((l: any) => [l.city, l.region, l.country].filter(Boolean).join(', '));
    return {
      title: oneLine(j.title, 200),
      company: companyOf(board, j._company),
      description: htmlToText(j.description),
      sourceUrl: safeUrl(j.url ?? j.shortlink),
      applyUrl: safeUrl(j.application_url ?? j.url),
      location: {
        texts: [...locs, [j.city, j.state, j.country].filter(Boolean).join(', ')],
        remote: j.telecommuting === true ? true : null,
        countries: (j.locations ?? []).map((l: any) => l.countryCode ?? countryCode(l.country)),
      },
      employmentHints: [j.employment_type],
      seniorityHint: j.experience,
      postedAt: toDate(j.published_on ?? j.created_at),
      labels: [j.department, j.function, j.industry],
    };
  },
};

export const atsConnectors = [greenhouse, lever, ashby, bamboohr, gupy, personio, recruitee, teamtailor, workable];
export type { FetchContext };

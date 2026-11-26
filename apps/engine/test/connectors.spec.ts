import { loadConfig } from '../src/config/config';
import { CONNECTORS } from '../src/ingest/connectors';
import { Http, HttpError, redact } from '../src/ingest/http';
import { tagLocation } from '../src/ingest/location';
import { BoardRow, isSkip, NormalisedJob, SourceRow } from '../src/ingest/types';
import { fakeFetch } from './fixtures/sources';

const config = {
  ...loadConfig(),
  ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key', JOOBLE_API_KEY: 'jk', CAREERJET_AFFID: 'aff',
  RELIEFWEB_APPNAME: 'ijobs-test', THEIRSTACK_API_KEY: 'tk',
};

const source = (key: string, conf: Record<string, unknown> = {}): SourceRow => ({
  key, name: key, kind: 'x', config: conf, excluded_origins: [], default_expiry_days: 30, apply_via_source_link: false, needs_ai_extraction: false,
});
const board: BoardRow = { id: '00000000-0000-0000-0000-0000000000b0', board_token: 'acme', company_name: 'Acme' };

async function run(key: string, opts: { conf?: Record<string, unknown>; known?: string[]; perBoard?: boolean } = {}) {
  const calls: string[] = [];
  const http = new Http('ijobs-test', 5000, fakeFetch(calls), async () => undefined);
  const c = CONNECTORS.get(key)!;
  const src = source(key, opts.conf);
  const b = c.perBoard ? board : null;
  const result = await c.fetch({ source: src, board: b, http, config, known: new Set(opts.known ?? []) });
  const jobs = result.items.filter((i) => !i.touchOnly).map((i) => c.normalise(i.payload, { source: src, board: b }));
  return { result, jobs, calls, ok: jobs.filter((j): j is NormalisedJob => !isSkip(j)) };
}

const loc = (j: NormalisedJob) => tagLocation(j.location);

describe('connectors', () => {
  it('covers all 24 external sources', () => {
    expect([...CONNECTORS.values()].filter((c) => !c.internal).map((c) => c.key).sort()).toEqual([
      'adzuna', 'ashby', 'bamboohr', 'bluesky', 'careerjet', 'getonboard', 'greenhouse', 'gupy', 'hackernews', 'himalayas',
      'jobicy', 'jooble', 'lever', 'personio', 'recruitee', 'reliefweb', 'remoteok', 'remotive', 'talent', 'teamtailor',
      'theirstack', 'weworkremotely', 'workable', 'workingnomads',
    ]);
  });

  it('greenhouse: double-escaped HTML and EMEA', async () => {
    const { ok, result } = await run('greenhouse');
    expect(result.complete).toBe(true);
    expect(ok[0]).toMatchObject({ title: 'Senior Backend Engineer', company: 'Acme', description: 'Build our payments API.\n\n• Go\n• PostgreSQL' });
    expect(loc(ok[0])).toMatchObject({ isRemote: true, scope: 'restricted', regions: ['emea'] });
  });

  it('lever: remote workplace, Nigeria, monthly pay', async () => {
    const { ok } = await run('lever');
    expect(ok[0]).toMatchObject({ title: 'Customer Support Specialist', applyUrl: 'https://jobs.lever.co/acme/a1b2c3d4/apply' });
    expect(ok[0].description).toContain('• Answer tickets');
    expect(ok[0].pay).toEqual({ minMinor: 100_000, maxMinor: 150_000, currency: 'USD', period: 'month' });
    expect(loc(ok[0])).toMatchObject({ isRemote: true, countries: ['NG'] });
  });

  it('ashby: skips unlisted jobs, reads compensation', async () => {
    const { ok } = await run('ashby');
    expect(ok).toHaveLength(1);
    expect(ok[0].pay).toMatchObject({ minMinor: 4_000_000, maxMinor: 6_000_000, period: 'year' });
    expect(loc(ok[0])).toMatchObject({ isRemote: true, countries: ['KE'] });
  });

  it('bamboohr: details only for jobs we do not have yet', async () => {
    const { result, ok, calls } = await run('bamboohr', { known: ['18'] });
    expect(calls.filter((c) => c.includes('/detail'))).toHaveLength(1);
    expect(result.items.find((i) => i.externalId === '18')?.touchOnly).toBe(true);
    expect(ok[0]).toMatchObject({ title: 'Bookkeeper', description: 'Keep our books.' });
    expect(ok[0].pay).toMatchObject({ currency: 'GHS', period: 'month' });
    expect(loc(ok[0])).toMatchObject({ isRemote: false, countries: ['GH'] });
  });

  it("gupy: only this company's jobs", async () => {
    const { ok } = await run('gupy');
    expect(ok.map((j) => j.title)).toEqual(['Desenvolvedor Full Stack']);
    expect(loc(ok[0])).toMatchObject({ isRemote: true, countries: ['BR'] });
  });

  it('personio: XML with CDATA sections', async () => {
    const { ok } = await run('personio');
    expect(ok[0]).toMatchObject({ title: 'Data Analyst (m/f/d)', company: 'Acme' });
    expect(ok[0].description).toBe('Your tasks\nBuild dashboards.\n\nYour profile\n• SQL');
    expect(loc(ok[0])).toMatchObject({ isRemote: false, countries: ['DE'] });
  });

  it('recruitee, teamtailor, workable', async () => {
    const r = (await run('recruitee')).ok[0];
    expect(r.pay).toMatchObject({ minMinor: 80_000, maxMinor: 120_000, period: 'month' });
    expect(loc(r).isRemote).toBe(true);
    const t = (await run('teamtailor')).ok[0];
    expect(t).toMatchObject({ title: 'Content Writer', description: 'Write our blog.' });
    expect(loc(t)).toMatchObject({ isRemote: true, countries: ['ZA'] });
    const w = (await run('workable')).ok[0];
    expect(w).toMatchObject({ title: 'Virtual Assistant', company: 'Acme' });
    expect(loc(w)).toMatchObject({ isRemote: true, countries: ['NG'] });
  });

  it('himalayas: country limits, time zones, applicationLink', async () => {
    const { ok } = await run('himalayas', { conf: { pages: 1 } });
    expect(ok[0].applyUrl).toBe('https://himalayas.app/companies/nimbus/jobs/frontend-engineer/apply');
    expect(loc(ok[0])).toMatchObject({ isRemote: true, scope: 'restricted', countries: ['KE', 'NG'], tzMin: 0, tzMax: 3 });
    expect(ok[0].deadline).toBeInstanceOf(Date);
  });

  it('jobicy, remoteok, remotive, weworkremotely, workingnomads', async () => {
    expect(loc((await run('jobicy')).ok[0]).scope).toBe('worldwide');
    const rok = await run('remoteok');
    expect(rok.ok).toHaveLength(1);
    expect(rok.ok[0].skills).toEqual(['devops', 'aws', 'kubernetes']);
    const rem = (await run('remotive', { conf: { limit: 300 } }));
    expect(rem.result.complete).toBe(true);
    expect(loc(rem.ok[0])).toMatchObject({ regions: ['africa', 'europe'] });
    expect(rem.ok[0].postedAt?.toISOString()).toBe('2026-11-12T08:50:16.000Z');
    const wwr = (await run('weworkremotely')).ok[0];
    expect(wwr).toMatchObject({ company: 'Pixel Co', title: 'Senior UI Designer' });
    expect(loc(wwr).scope).toBe('worldwide');
    expect(loc((await run('workingnomads')).ok[0]).regions).toEqual(['europe']);
  });

  it('company logos: taken where the source gives one, https only', async () => {
    expect((await run('himalayas', { conf: { pages: 1 } })).ok[0].companyLogo).toBe('https://cdn.himalayas.app/nimbus.png');
    expect((await run('jobicy')).ok[0].companyLogo).toBeNull(); // http, so not shown
    expect((await run('remoteok')).ok[0].companyLogo).toBe('https://remoteok.com/assets/cloudy.png'); // empty company_logo falls back to logo
    expect((await run('remotive', { conf: { limit: 300 } })).ok[0].companyLogo).toBe('https://remotive.com/job/123/logo');
    expect((await run('getonboard', { conf: { categories: ['programming'] } })).ok[0].companyLogo).toBe('https://getonbrd.com/logos/acme.png');
    expect((await run('theirstack')).ok[0].companyLogo).toBe('https://logos.theirstack.com/qaco.png');
    expect((await run('weworkremotely')).ok[0].companyLogo).toBeUndefined();
  });

  it('getonboard: keeps fully remote jobs open to all only', async () => {
    const { jobs, ok } = await run('getonboard', { conf: { categories: ['programming'] } });
    expect(ok.map((j) => j.title)).toEqual(['Ruby Developer']);
    expect(jobs.find((j) => isSkip(j))).toEqual({ skip: 'getonboard_not_fully_remote' });
  });

  it('adzuna: ignores predicted salaries, finds remote in text', async () => {
    const { ok, calls } = await run('adzuna', { conf: { countries: ['gb'], pages: 1 } });
    expect(ok[0]).toMatchObject({ title: 'Remote Python Developer', company: 'Snake Ltd' });
    expect(ok[0].pay).toMatchObject({ currency: 'GBP', minMinor: 5_500_000 });
    expect(loc(ok[0])).toMatchObject({ isRemote: true, countries: ['GB'] });
    expect(redact(calls[0])).toContain('app_key=***');
  });

  it('careerjet, jooble, reliefweb', async () => {
    const cj = (await run('careerjet', { conf: { locales: ['en_NG'] } })).ok[0];
    expect(cj.pay).toMatchObject({ currency: 'NGN', period: 'month', minMinor: 35_000_000 });
    expect(loc(cj)).toMatchObject({ isRemote: false, countries: ['NG'] });
    const jb = (await run('jooble')).ok[0];
    expect(jb.description).toBe('Write ads for & with brands.');
    expect(loc(jb).isRemote).toBe(true);
    const rw = (await run('reliefweb')).ok[0];
    expect(rw).toMatchObject({ company: 'Helping Hands International', companyDomain: 'hhi.example.org' });
    expect(rw.description).toContain('How to apply');
    expect(loc(rw)).toMatchObject({ isRemote: false, countries: ['NG'] });
  });

  it('theirstack: passes on where each job came from', async () => {
    const { ok } = await run('theirstack');
    expect(ok[1].originHosts).toContain('linkedin.com');
    expect(ok[0]).toMatchObject({ companyDomain: 'qa.example' });
  });

  it('bluesky and hackernews: code filter before AI', async () => {
    const bs = await run('bluesky', { conf: { queries: ['#hiring'] } });
    expect(bs.jobs.filter(isSkip)).toEqual([{ skip: 'not_a_job_post' }]);
    expect(bs.ok[0]).toMatchObject({ needsAi: true, applyUrl: 'https://acme.example/careers/react', sourceUrl: 'https://bsky.app/profile/acme.bsky.social/post/3kxyz' });
    const hn = await run('hackernews');
    expect(hn.ok).toHaveLength(1);
    expect(hn.ok[0]).toMatchObject({ company: 'Paystackish', applyEmail: 'jobs@paystackish.example', needsAi: true });
    expect(hn.jobs.filter(isSkip)).toEqual([{ skip: 'hn_not_remote' }]);
  });

  it('talent waits for publisher approval', async () => {
    await expect(run('talent')).rejects.toThrow(/publisher approval/);
  });

  it('credentials are checked before fetching', () => {
    const bare = { ...loadConfig() };
    expect(CONNECTORS.get('adzuna')!.missingCredentials!(bare)).toMatch(/ADZUNA/);
    expect(CONNECTORS.get('adzuna')!.missingCredentials!(config)).toBeNull();
  });
});

describe('http client', () => {
  it('retries 429 and 5xx, honouring Retry-After', async () => {
    const waits: number[] = [];
    let n = 0;
    const http = new Http('t', 1000, (async () => {
      n++;
      if (n === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } });
      if (n === 2) return new Response('oops', { status: 503 });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch, async (ms) => { waits.push(ms); });
    expect(await http.json('https://x.example')).toEqual({ ok: true });
    expect(waits[0]).toBe(2000);
    expect(n).toBe(3);
  });

  it('gives a clear error without leaking keys', async () => {
    const http = new Http('t', 1000, (async () => new Response('nope', { status: 404 })) as typeof fetch, async () => undefined);
    const err = await http.json('https://api.example/x?app_key=SECRET').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.message).not.toContain('SECRET');
  });
});

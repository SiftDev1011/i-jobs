import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiService } from '../src/ai/ai.service';
import { RedisService } from '../src/redis/redis.service';
import { cvText, CvUnreadable } from '../src/profile/cv-text';
import { CvParseService } from '../src/profile/cv-parse.service';
import { EmbeddingService } from '../src/matching/embedding.service';
import { MatchService } from '../src/matching/match.service';
import { fit } from '../src/matching/scoring';
import { strength, utcOffsetHours, yearsFromExperience } from '../src/profile/strength';
import { StorageService } from '../src/storage/storage.service';
import { SITE_KEYS } from './env';
import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';

const file = (n: string) => readFileSync(join(__dirname, 'fixtures/cv', n));
const PDF = 'application/pdf';
const TAG = `zr${Date.now().toString(36)}`;

const CV_ANSWER = {
  headline: 'Customer Support Specialist',
  summary: 'Customer support specialist with three years in fintech, handling tickets and live chat.',
  years_experience: 3,
  country: 'NG',
  city: 'Lagos',
  skills: ['Zendesk', 'Customer service', 'Excel', 'Live chat', 'Email support', 'zendesk'],
  experience: [
    { title: 'Support Agent', company: 'Paylite', start: '2022-01', end: null, current: true, highlights: ['Answered 60 tickets a day in Zendesk'] },
    { title: 'Customer Service Rep', company: 'ShopNow', start: '2021-01', end: '2021-12', highlights: [] },
  ],
  education: [{ school: 'University of Lagos', qualification: 'BSc Economics', year: 2020 }],
  languages: ['English', 'Yoruba'],
  links: [],
};

describe('CV text and scoring (no database)', () => {
  it('reads PDF and Word CVs, refuses others', async () => {
    const pdf = await cvText(file('cv.pdf'), { pdftotext: 'pdftotext' });
    expect(pdf).toContain('Answered 60 tickets a day in Zendesk');
    const docx = await cvText(file('cv.docx'), { pdftotext: 'pdftotext' });
    expect(docx).toContain('Skills: Zendesk, Customer service');
    await expect(cvText(file('scan.pdf'), { pdftotext: 'pdftotext' })).rejects.toMatchObject({ reason: 'no_text' });
    await expect(cvText(Buffer.from('MZ not a cv at all'.repeat(20)), { pdftotext: 'pdftotext' })).rejects.toBeInstanceOf(CvUnreadable);
  });

  it('profile strength and tips', () => {
    expect(strength({}).score).toBe(0);
    expect(strength({}).tips).toHaveLength(3);
    const full = strength({ headline: 'x', summary: 'y'.repeat(90), skills: Array(10).fill('s'), experience: [{ highlights: ['a', 'b'] }], education: [{}], links: ['https://a.example'], languages: ['English'], country: 'NG', timezone: 'Africa/Lagos', work_authorization: { remote_any_country: true } });
    expect(full).toEqual({ score: 100, tips: [] });
  });

  it('time zones and years of experience', () => {
    expect(utcOffsetHours('Africa/Lagos')).toBe(1);
    expect(utcOffsetHours('Not/AZone')).toBeNull();
    expect(yearsFromExperience([{ start: '2020-01-01', end: '2022-01-01' }, { start: '2021-01-01', end: '2023-01-01' }])).toBe(3);
  });

  it('scoring: skills, titles, place, hours and gaps', () => {
    const member = { skills: ['Zendesk', 'Customer service'], headline: 'Customer Support Specialist', titles: ['Support Agent'], years: 3, country: 'NG', utcOffset: 1 };
    const job = { title: 'Customer Support Agent', skills: ['zendesk', 'intercom'], text: 'Customer Support Agent. Use Zendesk and Intercom.', seniority: null, employment_type: 'full_time', location_scope: 'restricted' as const, allowed_countries: ['NG'], is_remote: true, tz_min: 0, tz_max: 3 };
    const f = fit(member, job, null)!;
    expect(f.score).toBeGreaterThanOrEqual(60);
    expect(f.reasons).toEqual(expect.arrayContaining(['Skills: Zendesk', 'Hours fit your time zone', 'Open to applicants in Nigeria']));
    expect(f.gaps).toEqual(['intercom']);
    expect(fit(member, { ...job, tz_min: -8, tz_max: -5 }, null)).toBeNull();
    const weak = fit(member, { ...job, title: 'Senior Rust Engineer', skills: ['rust'], text: 'Rust', seniority: 'senior' }, null)!;
    expect(weak.score).toBeLessThan(35);
    expect(fit(member, job, 0.75)!.score).toBeGreaterThan(f.score);
  });
});

describe('Profiles, matching and autopilot', () => {
  let ctx: TestCtx;
  let ai: AiService;
  let storage: StorageService;
  let matching: MatchService;

  const answer = (content: unknown) => async () => ({ status: 200, headers: new Headers(), json: { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 400 } } });
  const grant = (auth: Record<string, string>, purpose: string) => ctx.http().post('/v1/me/consents').set(auth).send({ purpose, granted: true, policy_version: '2026-11' }).expect(201);
  const viaSite = (externalId: string) => ({ 'X-Site-Key': SITE_KEYS['remote-hustle'], 'X-Site-User': externalId });
  const link = async (userId: string) => {
    const ext = `rh-${userId.slice(0, 8)}`;
    await ctx.admin.query(`INSERT INTO site_accounts (site_id, user_id, external_user_id) SELECT id, $1, $2 FROM sites WHERE slug = 'remote-hustle'`, [userId, ext]);
    return viaSite(ext);
  };

  async function uploadCv(auth: Record<string, string>, userId: string, bytes: Buffer) {
    const up = await ctx.http().post('/v1/me/cv').set(auth).send({ file_name: 'cv.pdf', content_type: PDF, size_bytes: bytes.length }).expect(201);
    const rec = JSON.parse((await ctx.app.get(RedisService).client.get(`cvupload:${up.body.upload_id}`))!);
    expect(rec.key).toMatch(new RegExp(`^cv/${userId}/`));
    await storage.put(rec.key, bytes, PDF);
    return up.body.upload_id as string;
  }

  async function addJob(o: { title: string; skills: string[]; source?: string; scope?: string; countries?: string[]; regions?: string[]; remote?: boolean; tz?: [number, number]; seniority?: string }) {
    const rawId = randomUUID();
    const source = o.source ?? 'greenhouse';
    await ctx.admin.query(`INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ($1::uuid, $2, $1::text, '{}', 'x', 'extracted')`, [rawId, source]);
    const id = (await ctx.admin.query(
      `INSERT INTO jobs (title, company_name, description, location_scope, allowed_countries, allowed_regions, is_remote, skills, apply_method, apply_url,
         primary_source_key, trust, status, expires_at, tz_min_offset_hours, tz_max_offset_hours, seniority, category)
       VALUES ($1, 'Acme', $2, $3, $4, $5, $6, $7, 'external_link', 'https://acme.example/apply', $8, 'careers_page', 'live', now() + interval '20 days', $9, $10, $11, 'customer-support') RETURNING id`,
      [`${o.title} ${TAG}`, `${o.title}. We use ${o.skills.join(', ')} every day. ${TAG}`, o.scope ?? 'worldwide', o.countries ?? [], o.regions ?? [], o.remote ?? true, o.skills, source, o.tz?.[0] ?? null, o.tz?.[1] ?? null, o.seniority ?? null],
    )).rows[0].id as string;
    await ctx.admin.query(`INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ($1, $2, $3, true)`, [id, rawId, source]);
    return id;
  }

  beforeAll(async () => {
    ctx = await startApp();
    ai = ctx.app.get(AiService);
    storage = ctx.app.get(StorageService);
    matching = ctx.app.get(MatchService);
  });
  afterAll(() => ctx.close());
  beforeEach(() => flushRateLimits(ctx));

  it('uploads a CV and reads it into a profile', async () => {
    const s = await signIn(ctx);
    await ctx.http().post('/v1/me/cv').set(s.auth).send({ file_name: 'cv.exe', content_type: 'application/x-msdownload', size_bytes: 10 }).expect(400);
    await ctx.http().post('/v1/me/cv').set(s.auth).send({ file_name: 'cv.pdf', content_type: PDF, size_bytes: 6 * 1024 * 1024 }).expect(400);
    const up = await ctx.http().post('/v1/me/cv').set(s.auth).send({ file_name: 'cv.pdf', content_type: PDF, size_bytes: 980 }).expect(201);
    expect(up.body).toMatchObject({ upload_id: expect.stringMatching(/^up_/), upload_url: expect.any(String), expires_at: expect.any(String) });

    expect((await ctx.http().post('/v1/me/cv/parse').set(s.auth).send({ upload_id: up.body.upload_id }).expect(403)).body.code).toBe('consent_required');
    await grant(s.auth, 'matching');
    expect((await ctx.http().post('/v1/me/cv/parse').set(s.auth).send({ upload_id: up.body.upload_id }).expect(409)).body.code).toBe('upload_missing');
    expect((await ctx.http().post('/v1/me/cv/parse').set(s.auth).send({ upload_id: 'up_nope' }).expect(404)).body.code).toBe('upload_not_found');

    const uploadId = await uploadCv(s.auth, s.userId, file('cv.pdf'));
    const queued = await ctx.http().post('/v1/me/cv/parse').set(s.auth).send({ upload_id: uploadId }).expect(202);
    expect(queued.body).toMatchObject({ kind: 'cv_parse', status: 'queued', scheduled_for: null, reason: null });
    await ctx.http().get('/v1/me/profile').set(s.auth).expect(404);

    let sent = '';
    ai.useChat(async (body: any) => {
      sent = body.messages[1].content;
      return answer(CV_ANSWER)();
    });
    expect(await ctx.app.get(CvParseService).run(queued.body.work_id)).toBe('done');
    expect(sent).toContain('Answered 60 tickets a day in Zendesk');

    const p = (await ctx.http().get('/v1/me/profile').set(s.auth).expect(200)).body;
    expect(p).toMatchObject({
      headline: 'Customer Support Specialist', country: 'NG', city: 'Lagos', skills: ['Zendesk', 'Customer service', 'Excel', 'Live chat', 'Email support'],
      cv: { uploaded: true, parsed_at: expect.any(String) }, needs_confirmation: true, confirmed_at: null,
    });
    expect(p.years_experience).toBeGreaterThan(4);
    expect(p.experience[0]).toMatchObject({ title: 'Support Agent', company: 'Paylite', start: '2022-01-01', end: null });
    expect(p.strength).toBeGreaterThan(40);
    expect(p.strength_tips.length).toBeGreaterThan(0);
    const note = (await ctx.admin.query(`SELECT type FROM notifications WHERE user_id = $1`, [s.userId])).rows;
    expect(note).toEqual([{ type: 'profile.ready' }]);
    expect((await ctx.admin.query(`SELECT status FROM work_items WHERE id = $1`, [queued.body.work_id])).rows[0].status).toBe('done');
  });

  it("says when the CV will wait for tomorrow's AI budget", async () => {
    const s = await signIn(ctx);
    await grant(s.auth, 'matching');
    const uploadId = await uploadCv(s.auth, s.userId, file('cv.pdf'));
    await ctx.admin.query(`UPDATE ai_task_budgets SET daily_tokens = 1 WHERE task = 'cv_parse'`);
    try {
      const res = await ctx.http().post('/v1/me/cv/parse').set(s.auth).send({ upload_id: uploadId }).expect(202);
      expect(res.body).toMatchObject({ status: 'scheduled', reason: 'daily_ai_budget', scheduled_for: expect.stringMatching(/T00:05:00/) });
    } finally {
      await ctx.admin.query(`UPDATE ai_task_budgets SET daily_tokens = 50000 WHERE task = 'cv_parse'`);
    }
  });

  it('tells the member when a CV cannot be read', async () => {
    const s = await signIn(ctx);
    await grant(s.auth, 'matching');
    const uploadId = await uploadCv(s.auth, s.userId, file('scan.pdf'));
    const res = await ctx.http().post('/v1/me/cv/parse').set(s.auth).send({ upload_id: uploadId }).expect(202);
    expect(await ctx.app.get(CvParseService).run(res.body.work_id)).toBe('failed');
    const n = (await ctx.admin.query(`SELECT type, body FROM notifications WHERE user_id = $1`, [s.userId])).rows[0];
    expect(n.type).toBe('cv.unreadable');
    expect(n.body).toMatch(/scan or a photo/);
  });

  it('edits and confirms a profile', async () => {
    const s = await signIn(ctx);
    expect((await ctx.http().patch('/v1/me/profile').set(s.auth).send({ timezone: 'Mars/Base' }).expect(400)).body.errors[0].field).toBe('timezone');
    await ctx.http().patch('/v1/me/profile').set(s.auth).send({ salary: 5 }).expect(400);
    const p = await ctx.http().patch('/v1/me/profile').set(s.auth).send({
      headline: 'Virtual assistant', country: 'ng', timezone: 'Africa/Lagos', skills: ['Calendar management', 'Email', ' email '],
      work_authorization: { remote_any_country: true, countries: ['gh'] }, links: ['https://ada.example'],
    }).expect(200);
    expect(p.body).toMatchObject({ country: 'NG', skills: ['Calendar management', 'Email'], work_authorization: { remote_any_country: true, countries: ['GH'] }, cv: { uploaded: false } });
    expect((await ctx.admin.query(`SELECT utc_offset_hours FROM profiles WHERE user_id = $1`, [s.userId])).rows[0].utc_offset_hours).toBe(1);
    const c = await ctx.http().post('/v1/me/profile/confirm').set(s.auth).expect(200);
    expect(c.body).toMatchObject({ needs_confirmation: false, confirmed_at: expect.any(String) });
  });

  describe('matching', () => {
    let member: Awaited<ReturnType<typeof signIn>>;
    let site: Record<string, string>;
    const jobs: Record<string, string> = {};

    beforeAll(async () => {
      member = await signIn(ctx);
      site = await link(member.userId);
      await ctx.http().patch('/v1/me/profile').set(member.auth).send({
        headline: 'Customer Support Specialist', country: 'NG', timezone: 'Africa/Lagos', years_experience: 3,
        skills: ['Zendesk', 'Customer service', 'Live chat'], experience: [{ title: 'Support Agent', company: 'Paylite' }],
      }).expect(200);
      jobs.support = await addJob({ title: 'Customer Support Agent', skills: ['zendesk', 'intercom'] });
      jobs.africa = await addJob({ title: 'Support Specialist', skills: ['live chat'], scope: 'restricted', regions: ['africa'], tz: [0, 3] });
      jobs.lagos = await addJob({ title: 'Customer Service Officer', skills: ['customer service'], scope: 'restricted', countries: ['NG'], remote: false });
      jobs.usOnly = await addJob({ title: 'Customer Support Agent US', skills: ['zendesk'], scope: 'restricted', countries: ['US'] });
      jobs.farTz = await addJob({ title: 'Support Agent Pacific', skills: ['zendesk'], tz: [-8, -7] });
      jobs.remotive = await addJob({ title: 'Customer Support Remotive', skills: ['zendesk'], source: 'remotive' });
      jobs.rust = await addJob({ title: 'Senior Rust Engineer', skills: ['rust', 'tokio'], seniority: 'senior' });
    });

    it('scores only jobs the member can take, from sources that allow matching', async () => {
      await matching.matchMember(member.userId);
      const rows = (await ctx.admin.query(`SELECT job_id, score FROM matches WHERE user_id = $1 ORDER BY score DESC`, [member.userId])).rows;
      const ids = rows.map((r) => r.job_id);
      expect(ids).toEqual(expect.arrayContaining([jobs.support, jobs.africa, jobs.lagos]));
      for (const excluded of [jobs.usOnly, jobs.farTz, jobs.remotive, jobs.rust]) expect(ids).not.toContain(excluded);
    });

    it('lists matches with reasons and gaps linked to partner courses', async () => {
      expect((await ctx.http().get('/v1/me/matches').set(member.auth).expect(403)).body.code).toBe('membership_inactive');

      await ctx.http().put('/v1/partner/trainings').set(site).send([{ id: 'c1', title: 'Intercom basics', url: 'https://remotehustle.example/c/intercom', skills: ['Intercom'], duration_minutes: 45 }]).expect(202);
      await matching.matchMember(member.userId);

      const res = await ctx.http().get('/v1/me/matches?limit=50').set(site).expect(200);
      const mine = res.body.items.filter((m: any) => m.job.title.endsWith(TAG));
      const top = mine.find((m: any) => m.job.id === jobs.support);
      expect(top).toMatchObject({ status: 'new', job: { match_score: top.score } });
      expect(top.reasons).toContain('Skills: Zendesk');
      expect(top.gaps).toEqual([{ skill: 'intercom', training: { id: 'c1', title: 'Intercom basics', url: 'https://remotehustle.example/c/intercom', skills: ['intercom'], duration_minutes: 45, is_free: true, suitable_for_minors: false } }]);
      const africa = mine.find((m: any) => m.job.id === jobs.africa);
      expect(africa.reasons).toContain('Hours fit your time zone');
      const scores = res.body.items.map((m: any) => m.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('marks matches and pages through them', async () => {
      await ctx.http().patch(`/v1/me/matches/${jobs.lagos}`).set(site).send({ status: 'dismissed' }).expect(200);
      const def = (await ctx.http().get('/v1/me/matches?limit=50').set(site).expect(200)).body.items.map((m: any) => m.job.id);
      expect(def).not.toContain(jobs.lagos);
      const dismissed = (await ctx.http().get('/v1/me/matches?status=dismissed').set(site).expect(200)).body.items;
      expect(dismissed.map((m: any) => m.job.id)).toEqual([jobs.lagos]);
      const seen = await ctx.http().patch(`/v1/me/matches/${jobs.support}`).set(site).send({ status: 'seen' }).expect(200);
      expect(seen.body.status).toBe('seen');
      expect((await ctx.http().patch(`/v1/me/matches/${jobs.rust}`).set(site).send({ status: 'seen' }).expect(404)).body.code).toBe('match_not_found');

      const p1 = await ctx.http().get('/v1/me/matches?limit=1').set(site).expect(200);
      const p2 = await ctx.http().get(`/v1/me/matches?limit=1&cursor=${p1.body.next_cursor}`).set(site).expect(200);
      expect(p2.body.items[0].job.id).not.toBe(p1.body.items[0].job.id);
      expect(p2.body.items[0].score).toBeLessThanOrEqual(p1.body.items[0].score);
      // Recomputing keeps the member's own choices.
      await matching.matchMember(member.userId);
      expect((await ctx.admin.query(`SELECT status FROM matches WHERE user_id = $1 AND job_id = $2`, [member.userId, jobs.lagos])).rows[0].status).toBe('dismissed');
    });

    it('uses embeddings when Voyage is set up, and matches new jobs to existing members', async () => {
      const emb = ctx.app.get(EmbeddingService);
      // A stand-in for Voyage: similar words give similar vectors.
      const vec = (text: string) => {
        const v = new Array(1024).fill(0);
        for (const w of text.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 3)) v[parseInt(createHash('md5').update(w).digest('hex').slice(0, 4), 16) % 1024] += 1;
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      };
      const calls: string[] = [];
      emb.useEmbed(async (body) => {
        calls.push(body.input_type);
        return { status: 200, json: { data: body.input.map((t, index) => ({ index, embedding: vec(t) })) } };
      });
      const embedded = await matching.embedJobs(500);
      expect(embedded).toBeGreaterThan(0);
      expect((await ctx.admin.query(`SELECT count(*)::int AS n FROM jobs WHERE id = $1 AND embedding IS NOT NULL`, [jobs.remotive])).rows[0].n).toBe(0);

      await matching.matchMember(member.userId);
      expect(calls).toContain('query');

      const fresh = await addJob({ title: 'Live Chat Support Agent', skills: ['live chat', 'zendesk'] });
      await matching.embedJobs(500);
      const out = await matching.matchNewJobs(500);
      expect(out.jobs).toBeGreaterThan(0);
      const m = (await ctx.admin.query(`SELECT score FROM matches WHERE user_id = $1 AND job_id = $2`, [member.userId, fresh])).rows[0];
      expect(m.score).toBeGreaterThanOrEqual(35);
      expect((await ctx.admin.query(`SELECT matched_at FROM jobs WHERE id = $1`, [fresh])).rows[0].matched_at).not.toBeNull();
    });

    it('partner course lists replace what the site sent before', async () => {
      await ctx.http().put('/v1/partner/trainings').set(site).send([{ id: 'c2', title: 'Zendesk', url: 'https://remotehustle.example/c/zendesk', skills: ['Zendesk'] }]).expect(202);
      const rows = (await ctx.admin.query(`SELECT external_id, active FROM trainings t JOIN sites s ON s.id = t.site_id WHERE s.slug = 'remote-hustle' ORDER BY external_id`)).rows;
      expect(rows).toEqual([{ external_id: 'c1', active: false }, { external_id: 'c2', active: true }]);
      await ctx.http().put('/v1/partner/trainings').set(site).send([{ id: 'x', title: 'a', url: 'https://a.example' }, { id: 'x', title: 'b', url: 'https://b.example' }]).expect(400);
      // A member's own token is not a site key.
      await ctx.http().put('/v1/partner/trainings').set(member.auth).send([]).expect(401);
    });

    it('autopilot rules: defaults, then the checks before switching on', async () => {
      expect((await ctx.http().get('/v1/me/autopilot').set(site).expect(200)).body).toEqual({
        enabled: false, min_match: 80, min_pay_monthly: null, regions: ['worldwide'], include_unspecified: false, employment_types: [], daily_cap: 5, paused_until: null,
      });
      expect((await ctx.http().put('/v1/me/autopilot').set(member.auth).send({ enabled: true }).expect(403)).body.code).toBe('membership_inactive');
      expect((await ctx.http().put('/v1/me/autopilot').set(site).send({ enabled: true }).expect(403)).body.code).toBe('consent_required');
      await grant(member.auth, 'autopilot');
      expect((await ctx.http().put('/v1/me/autopilot').set(site).send({ enabled: true }).expect(403)).body.code).toBe('profile_not_confirmed');
      await ctx.http().post('/v1/me/profile/confirm').set(member.auth).expect(200);
      expect((await ctx.http().put('/v1/me/autopilot').set(site).send({ regions: ['mars'] }).expect(400)).body.errors[0].field).toBe('regions.0');

      const on = await ctx.http().put('/v1/me/autopilot').set(site).send({
        enabled: true, min_match: 70, regions: ['worldwide', 'africa', 'ng'], daily_cap: 8, min_pay_monthly: { amount_minor: 30000000, currency: 'ngn' }, employment_types: ['full_time', 'contract'],
      }).expect(200);
      expect(on.body).toMatchObject({ enabled: true, min_match: 70, regions: ['worldwide', 'africa', 'NG'], daily_cap: 8, min_pay_monthly: { amount_minor: 30000000, currency: 'NGN' }, employment_types: ['full_time', 'contract'] });
      expect((await ctx.admin.query(`SELECT consent_id FROM autopilot_rules WHERE user_id = $1`, [member.userId])).rows[0].consent_id).not.toBeNull();
      const off = await ctx.http().put('/v1/me/autopilot').set(site).send({ enabled: false }).expect(200);
      expect(off.body).toMatchObject({ enabled: false, min_match: 70 });
    });
  });
});

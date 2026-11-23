import { randomUUID } from 'node:crypto';
import { signIn, startApp, TestCtx } from './helpers';

/** Each test run uses its own made-up word, so other test files' jobs never get in the way. */
const TAG = `zq${Date.now().toString(36)}`;

describe('Jobs API', () => {
  let ctx: TestCtx;

  async function addJob(o: Partial<Record<string, any>> & { source: string; title: string }) {
    const rawId = randomUUID();
    await ctx.admin.query(`INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ($1::uuid, $2, $1::text, '{}', 'x', 'extracted')`, [rawId, o.source]);
    const firstSeen = o.first_seen_at ?? new Date();
    const job = (await ctx.admin.query(
      `INSERT INTO jobs (title, company_name, description, location_scope, allowed_countries, is_remote, employment_type, category,
         salary_min_minor, salary_max_minor, salary_currency, salary_period, apply_method, apply_url, apply_email, primary_source_key,
         trust, status, first_seen_at, expires_at, seniority)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
      [
        `${o.title} ${TAG}`, o.company ?? 'Acme', `${o.title} description ${TAG}. Long enough to be a real job.`, o.scope ?? 'worldwide', o.countries ?? [],
        o.employment ?? 'full_time', o.category ?? 'engineering', o.payMin ?? null, o.payMax ?? null, o.currency ?? null, o.period ?? null,
        o.method ?? 'external_link', o.method === 'email' ? null : (o.applyUrl ?? 'https://acme.example/apply'), o.method === 'email' ? 'jobs@acme.example' : null,
        o.source, o.trust ?? 'unverified', o.status ?? 'live', firstSeen, o.expires ?? new Date(Date.now() + 20 * 86400_000), o.seniority ?? null,
      ],
    )).rows[0].id as string;
    await ctx.admin.query(
      `INSERT INTO job_sources (job_id, raw_posting_id, source_key, source_url, apply_url, is_primary) VALUES ($1, $2, $3, $4, $5, true)`,
      [job, rawId, o.source, `https://${o.source}.example/jobs/${job}`, o.sourceApplyUrl ?? null],
    );
    return job;
  }

  let ids: Record<string, string>;
  beforeAll(async () => {
    ctx = await startApp();
    ids = {
      backend: await addJob({ source: 'greenhouse', title: 'Backend Engineer', trust: 'careers_page', payMin: 300_000, payMax: 400_000, currency: 'USD', period: 'month' }),
      support: await addJob({ source: 'jobicy', title: 'Support Agent', category: 'customer-support', employment: 'part_time', scope: 'restricted', countries: ['NG'], payMin: 2_400_000, currency: 'USD', period: 'year' }),
      intern: await addJob({ source: 'jobicy', title: 'Design Intern', category: 'internships', employment: 'internship', expires: new Date(Date.now() + 86400_000), method: 'email' }),
      remotive: await addJob({ source: 'remotive', title: 'Remotive Writer', category: 'writing', sourceApplyUrl: 'https://remotive.com/remote-jobs/writing/x', first_seen_at: new Date(Date.now() - 2 * 86400_000) }),
      remotiveFresh: await addJob({ source: 'remotive', title: 'Remotive Fresh' }),
      pending: await addJob({ source: 'jobicy', title: 'Pending Thing', status: 'pending_review' }),
      expired: await addJob({ source: 'jobicy', title: 'Old Thing', status: 'expired' }),
    };
  });
  afterAll(() => ctx.close());

  it('searches live jobs from full-display sources only', async () => {
    const res = await ctx.http().get(`/v1/jobs?q=${TAG}&limit=50`).expect(200);
    const titles = res.body.items.map((j: any) => j.title.replace(` ${TAG}`, '')).sort();
    expect(titles).toEqual(['Backend Engineer', 'Design Intern', 'Support Agent']);
    expect(res.body.next_cursor).toBeNull();
  });

  it('filters', async () => {
    const t = async (qs: string) => (await ctx.http().get(`/v1/jobs?q=${TAG}&${qs}`).expect(200)).body.items.map((j: any) => j.title.split(' ')[0]).sort();
    expect(await t('location=restricted')).toEqual(['Support']);
    expect(await t('employment_type=part_time,internship')).toEqual(['Design', 'Support']);
    expect(await t('category=internships')).toEqual(['Design']);
    expect(await t('verified_only=true')).toEqual(['Backend']);
    // $3,000/month vs $24,000/year (= $2,000/month)
    expect(await t('min_pay_monthly=250000&currency=USD')).toEqual(['Backend']);
    expect(await t('min_pay_monthly=150000')).toEqual(['Backend', 'Support']);
    const bad = await ctx.http().get('/v1/jobs?location=mars').expect(400);
    expect(bad.body.errors[0].field).toBe('location.0');
  });

  it('pages with a cursor', async () => {
    const p1 = await ctx.http().get(`/v1/jobs?q=${TAG}&limit=2`).expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await ctx.http().get(`/v1/jobs?q=${TAG}&limit=2&cursor=${p1.body.next_cursor}`).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.next_cursor).toBeNull();
    const all = [...p1.body.items, ...p2.body.items].map((j: any) => j.id);
    expect(new Set(all).size).toBe(3);
    expect((await ctx.http().get('/v1/jobs?cursor=garbage').expect(400)).body.code).toBe('invalid_cursor');
  });

  it('job summaries carry badges, pay, credit and apply rules', async () => {
    const items = (await ctx.http().get(`/v1/jobs?q=${TAG}&limit=50`).expect(200)).body.items;
    const intern = items.find((j: any) => j.id === ids.intern);
    expect(intern.badges).toEqual(expect.arrayContaining(['new_today', 'closes_soon', 'internship']));
    expect(intern.apply).toEqual({ method: 'email', url: null, autopilot_eligible: false });
    const support = items.find((j: any) => j.id === ids.support);
    expect(support.source).toEqual({ key: 'jobicy', credit: 'via Jobicy', url: `https://jobicy.example/jobs/${ids.support}` });
    expect(support.pay).toEqual({ min_minor: 2_400_000, max_minor: null, currency: 'USD', period: 'year' });
    expect(support.badges).toContain('side_gig');
    const backend = items.find((j: any) => j.id === ids.backend);
    expect(backend.source.credit).toBeNull();
    expect(backend.match_score).toBeNull();
  });

  it('one job: detail, closed and hidden jobs', async () => {
    const d = await ctx.http().get(`/v1/jobs/${ids.backend}`).expect(200);
    expect(d.body).toMatchObject({ id: ids.backend, trust: 'careers_page', skills: [], timezone_hours: { min_offset: null, max_offset: null }, community: null });
    expect(d.body.description).toContain(TAG);
    expect((await ctx.http().get(`/v1/jobs/${ids.expired}`).expect(410)).body.code).toBe('job_closed');
    expect((await ctx.http().get(`/v1/jobs/${ids.pending}`).expect(404)).body.code).toBe('job_not_found');
    await ctx.http().get(`/v1/jobs/${randomUUID()}`).expect(404);
    await ctx.http().get('/v1/jobs/not-a-uuid').expect(400);
  });

  it('job finds include free-display sources after their delay, with their own apply link', async () => {
    const all: any[] = [];
    let cursor: string | null = null;
    do {
      const res: any = await ctx.http().get(`/v1/job-finds?limit=100${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      all.push(...res.body.items);
      cursor = res.body.next_cursor;
      expect(res.body.community).toBeNull();
    } while (cursor);
    const mine = all.filter((j) => j.title.endsWith(TAG));
    expect(mine.map((j) => j.title.replace(` ${TAG}`, '')).sort()).toEqual(['Backend Engineer', 'Design Intern', 'Remotive Writer', 'Support Agent']);
    const writer = mine.find((j) => j.id === ids.remotive);
    expect(writer.source.credit).toBe('via Remotive');
    expect(writer.apply.url).toBe('https://remotive.com/remote-jobs/writing/x');
    // Remotive asks for a 24-hour delay, so the fresh one isn't there yet.
    expect(mine.find((j) => j.id === ids.remotiveFresh)).toBeUndefined();
  });

  it('reports: once per member; three reports hide an unverified job', async () => {
    await ctx.http().post(`/v1/jobs/${ids.support}/reports`).send({ reason: 'scam' }).expect(401);
    const users = [await signIn(ctx), await signIn(ctx), await signIn(ctx)];
    await ctx.http().post(`/v1/jobs/${ids.support}/reports`).set(users[0].auth).send({ reason: 'asks_for_money', details: 'Wanted a fee' }).expect(202);
    expect((await ctx.http().post(`/v1/jobs/${ids.support}/reports`).set(users[0].auth).send({ reason: 'scam' }).expect(409)).body.code).toBe('already_reported');
    await ctx.http().get(`/v1/jobs/${ids.support}`).expect(200);
    await ctx.http().post(`/v1/jobs/${ids.support}/reports`).set(users[1].auth).send({ reason: 'scam' }).expect(202);
    await ctx.http().post(`/v1/jobs/${ids.support}/reports`).set(users[2].auth).send({ reason: 'scam' }).expect(202);
    await ctx.http().get(`/v1/jobs/${ids.support}`).expect(404);
    const item = (await ctx.admin.query(`SELECT reason_internal FROM moderation_items WHERE subject_id = $1`, [ids.support])).rows[0];
    expect(item.reason_internal).toMatch(/3 member reports/);
    await ctx.http().post(`/v1/jobs/${ids.backend}/reports`).set(users[0].auth).send({ reason: 'bribery' }).expect(400);
  });

  describe('admin', () => {
    let admin: Awaited<ReturnType<typeof signIn>>;
    let moderator: Awaited<ReturnType<typeof signIn>>;
    beforeAll(async () => {
      admin = await signIn(ctx);
      moderator = await signIn(ctx);
      await ctx.admin.query(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'admin'), ($2, 'moderator')`, [admin.userId, moderator.userId]);
    });

    it('is for staff only', async () => {
      const member = await signIn(ctx);
      expect((await ctx.http().get('/v1/admin/sources').set(member.auth).expect(403)).body.code).toBe('staff_only');
      expect((await ctx.http().patch('/v1/admin/sources/remotive').set(moderator.auth).send({ display: 'full' }).expect(403)).body.code).toBe('role_required');
    });

    it('lists sources with health and changes their rules, with an audit trail', async () => {
      const list = (await ctx.http().get('/v1/admin/sources').set(admin.auth).expect(200)).body;
      expect(list).toHaveLength(27);
      expect(list.find((s: any) => s.key === 'remotive')).toMatchObject({ display: 'job_finds_only', health: { jobs_live: expect.any(Number), failures_in_a_row: expect.any(Number) } });

      const res = await ctx.http().patch('/v1/admin/sources/remotive').set(admin.auth).send({ display: 'full', allow_paywall: true, notes: 'Written permission received.' }).expect(200);
      expect(res.body).toMatchObject({ key: 'remotive', display: 'full', allow_paywall: true });
      const audit = (await ctx.admin.query(`SELECT meta FROM audit_log WHERE action = 'source.update' ORDER BY at DESC LIMIT 1`)).rows[0];
      expect(audit.meta.changed.display).toEqual({ from: 'job_finds_only', to: 'full' });
      await ctx.http().patch('/v1/admin/sources/remotive').set(admin.auth).send({ display: 'job_finds_only', allow_paywall: false }).expect(200);

      expect((await ctx.http().patch('/v1/admin/sources/remotive').set(admin.auth).send({ api_key: 'x' }).expect(400)).body.code).toBe('invalid_request');
      expect((await ctx.http().patch('/v1/admin/sources/nope').set(admin.auth).send({ enabled: false }).expect(404)).body.code).toBe('source_not_found');
    });

    it("shows today's AI budget", async () => {
      const res = await ctx.http().get('/v1/admin/ai-budget').set(admin.auth).expect(200);
      expect(res.body.tasks).toHaveLength(7);
      expect(res.body.tasks.find((t: any) => t.task === 'job_extract')).toMatchObject({ model: 'groq:openai/gpt-oss-20b', daily_tokens: 100000 });
      expect(res.body.resets_at).toMatch(/T00:00:00.000Z$/);
      expect(res.body.waiting).toEqual(expect.objectContaining({ job_extract: expect.any(Number) }));
    });

    it('takes a scam down and remembers its text', async () => {
      await ctx.http().post(`/v1/admin/jobs/${ids.intern}/takedown`).set(moderator.auth).send({ reason: 'scam' }).expect(204);
      expect((await ctx.admin.query(`SELECT status, closed_reason FROM jobs WHERE id = $1`, [ids.intern])).rows[0]).toEqual({ status: 'scam', closed_reason: 'takedown:scam' });
      expect((await ctx.admin.query(`SELECT count(*)::int AS n FROM scam_signatures WHERE example_job_id = $1`, [ids.intern])).rows[0].n).toBe(1);
      await ctx.http().get(`/v1/jobs/${ids.intern}`).expect(410);
    });
  });
});

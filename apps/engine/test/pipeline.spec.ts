import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AiService } from '../src/ai/ai.service';
import { Http } from '../src/ingest/http';
import { IngestService } from '../src/ingest/ingest.service';
import { PipelineService } from '../src/ingest/pipeline.service';
import { JobHandlers } from '../src/ingest/scheduler';
import { UpkeepService } from '../src/ingest/upkeep.service';
import { RedisService } from '../src/redis/redis.service';
import { WorkerModule } from '../src/worker.module';
import { testDbUrl } from './env';
import { FIXTURES, fakeFetch } from './fixtures/sources';

describe('Ingest pipeline', () => {
  let ctx: INestApplicationContext;
  let db: Pool;
  let ingest: IngestService;
  let pipeline: PipelineService;
  let upkeep: UpkeepService;
  let http: Http;
  let ai: AiService;
  const boards: Record<string, string> = {};

  const job = async (where: string, params: unknown[] = []) => (await db.query(`SELECT * FROM jobs WHERE ${where}`, params)).rows[0];
  const raw = async (source: string, externalId: string) =>
    (await db.query(`SELECT * FROM raw_postings WHERE source_key = $1 AND external_id = $2`, [source, externalId])).rows[0];
  const addRaw = async (source: string, externalId: string, payload: object) =>
    (await db.query(`INSERT INTO raw_postings (source_key, external_id, payload, content_hash) VALUES ($1, $2, $3::jsonb, md5($4)) RETURNING id`, [source, externalId, JSON.stringify(payload), JSON.stringify(payload)])).rows[0].id as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    ctx = await mod.init();
    db = new Pool({ connectionString: testDbUrl(), max: 2 });
    ingest = ctx.get(IngestService);
    pipeline = ctx.get(PipelineService);
    upkeep = ctx.get(UpkeepService);
    ai = ctx.get(AiService);
    http = ctx.get(Http);
    http.useFetch(fakeFetch());
    for (const s of ['greenhouse', 'lever', 'ashby']) {
      boards[s] = (await db.query(`INSERT INTO source_boards (source_key, board_token, company_name) VALUES ($1, 'acme', 'Acme') RETURNING id`, [s])).rows[0].id;
    }
    await db.query(`UPDATE sources SET config = '{"limit": 300}' WHERE key = 'remotive'`);
  });

  afterAll(async () => {
    await ctx.get(RedisService).client.flushdb();
    await db.end();
    await ctx.close();
  });

  it('fetches a company board and turns it into a live job', async () => {
    const stats = await ingest.fetchUnit({ sourceKey: 'greenhouse', boardId: boards.greenhouse });
    expect(stats).toMatchObject({ ok: true, fetched: 1, created: 1 });
    expect(await pipeline.processBatch()).toEqual({ created: 1 });

    const j = await job(`title = 'Senior Backend Engineer'`);
    expect(j).toMatchObject({
      status: 'live', trust: 'careers_page', company_name: 'Acme', is_remote: true, location_scope: 'restricted',
      allowed_regions: ['emea'], category: 'engineering', apply_method: 'external_link', seniority: 'senior',
      dedupe_key: 'acme|senior backend engineer|remote', primary_source_key: 'greenhouse',
    });
    expect(j.description).toContain('• PostgreSQL');

    // Same listing again: nothing new, nothing reprocessed.
    const again = await ingest.fetchUnit({ sourceKey: 'greenhouse', boardId: boards.greenhouse });
    expect(again).toMatchObject({ ok: true, created: 0, updated: 0 });
    expect(await pipeline.processBatch()).toEqual({});
  });

  it('keeps Nigerian remote jobs and reads pay', async () => {
    await ingest.fetchUnit({ sourceKey: 'lever', boardId: boards.lever });
    await pipeline.processBatch();
    const j = await job(`title = 'Customer Support Specialist'`);
    expect(j).toMatchObject({ status: 'live', allowed_countries: ['NG'], category: 'customer-support', salary_currency: 'USD', salary_period: 'month', salary_min_minor: '100000' });
  });

  it('merges the same job from a remote board into the employer listing', async () => {
    const id = await addRaw('jobicy', 'dup-1', {
      id: 'dup-1', url: 'https://jobicy.com/jobs/dup-1', jobTitle: 'Sr. Backend Engineer (Remote)', companyName: 'Acme Inc.',
      jobGeo: 'EMEA', jobDescription: '<p>Build our payments API in Go. A long enough description for the filters.</p>', pubDate: '2026-11-12 08:00:00',
    });
    expect(await pipeline.processOne(id)).toMatchObject({ result: 'merged' });
    const j = await job(`title = 'Senior Backend Engineer'`);
    const sources = (await db.query(`SELECT source_key, is_primary FROM job_sources WHERE job_id = $1 ORDER BY added_at`, [j.id])).rows;
    expect(sources).toEqual([{ source_key: 'greenhouse', is_primary: true }, { source_key: 'jobicy', is_primary: false }]);
  });

  it('a better source found later becomes the primary one', async () => {
    const boardId = (await db.query(`INSERT INTO raw_postings (source_key, external_id, payload, content_hash) VALUES ('jobicy', 'pd-1', $1, 'x') RETURNING id`, [JSON.stringify({
      id: 'pd-1', url: 'https://jobicy.com/jobs/pd-1', jobTitle: 'Product Designer', companyName: 'Acme', jobGeo: 'Anywhere',
      jobDescription: '<p>Design flows for our mobile app, with research and prototypes.</p>', pubDate: '2026-11-12 08:00:00',
    })])).rows[0].id;
    await pipeline.processOne(boardId);
    expect(await job(`title = 'Product Designer'`)).toMatchObject({ primary_source_key: 'jobicy', trust: 'unverified' });

    await ingest.fetchUnit({ sourceKey: 'ashby', boardId: boards.ashby });
    await pipeline.processBatch();
    const j = await job(`title = 'Product Designer'`);
    expect(j).toMatchObject({ primary_source_key: 'ashby', trust: 'careers_page', salary_period: 'year' });
    expect((await db.query(`SELECT count(*)::int AS n FROM jobs WHERE title = 'Product Designer'`)).rows[0].n).toBe(1);
  });

  it('closes jobs that vanish from a complete listing', async () => {
    const before = await job(`title = 'Customer Support Specialist'`);
    const swapped = FIXTURES.find(([k]) => k.startsWith('api.lever.co'))!;
    const original = swapped[1];
    swapped[1] = [{ ...(original as any[])[0], id: 'another-role', text: 'Another Role' }];
    try {
      const stats = await ingest.fetchUnit({ sourceKey: 'lever', boardId: boards.lever });
      expect(stats.closed).toBe(1);
    } finally {
      swapped[1] = original;
    }
    expect(await job(`id = $1`, [before.id])).toMatchObject({ status: 'expired', closed_reason: 'gone_from_source' });
    await pipeline.processBatch();
  });

  it('blocks obvious scams and queues them for a moderator', async () => {
    const id = await addRaw('jobicy', 'scam-1', {
      id: 'scam-1', url: 'https://jobicy.com/jobs/scam-1', jobTitle: 'Data Entry Clerk', companyName: 'Quick Cash Ltd', jobGeo: 'Anywhere',
      jobDescription: '<p>Earn $500 per day from home. Pay a one-time registration fee of $30 to start. Contact us on WhatsApp now, limited slots.</p>',
      pubDate: '2026-11-12 08:00:00',
    });
    expect(await pipeline.processOne(id)).toMatchObject({ result: 'created', status: 'scam' });
    const j = await job(`company_name = 'Quick Cash Ltd'`);
    const item = (await db.query(`SELECT * FROM moderation_items WHERE subject_id = $1`, [j.id])).rows[0];
    expect(item.reason_internal).toMatch(/asks_for_money/);
    expect(Number(item.risk_score)).toBeGreaterThanOrEqual(0.7);
  });

  it('applies source rules: excluded origins, on-site outside our area, closed deadlines', async () => {
    http.useFetch(fakeFetch());
    const config = (ingest as any).config;
    config.THEIRSTACK_API_KEY = 'tk';
    config.ADZUNA_APP_ID = 'id';
    config.ADZUNA_APP_KEY = 'key';
    await db.query(`UPDATE sources SET config = '{"countries":["gb"],"pages":1}' WHERE key = 'adzuna'`);
    await ingest.fetchUnit({ sourceKey: 'theirstack', boardId: null });
    await ingest.fetchUnit({ sourceKey: 'adzuna', boardId: null });
    await pipeline.processBatch();
    expect((await raw('theirstack', '900002')).filter_reason).toBe('excluded_origin:linkedin.com');
    expect(await job(`title = 'QA Engineer'`)).toMatchObject({ status: 'live', apply_url: 'https://careers.qa.example/qa' });
    expect(await job(`title = 'Remote Python Developer'`)).toMatchObject({ allowed_countries: ['GB'], salary_currency: 'GBP' });

    // Careerjet is a general board, so on-site jobs are possible; we keep on-site only in INGEST_ONSITE_COUNTRIES (NG).
    const onsite = await addRaw('careerjet', 'onsite-1', { title: 'Barista', company: 'Cafe', locations: 'Berlin', url: 'https://jobviewtrack.com/v/onsite-1', description: 'Make coffee in our Berlin cafe every morning and afternoon.', _locale: 'de_DE' });
    expect(await pipeline.processOne(onsite)).toEqual({ result: 'filtered', reason: 'onsite_outside_area' });
  });

  it('free-text posts wait for AI when there is no key, then use it', async () => {
    await ingest.fetchUnit({ sourceKey: 'hackernews', boardId: null });
    const r = await raw('hackernews', '45000001');
    expect(await pipeline.processOne(r.id)).toMatchObject({ result: 'deferred', reason: 'ai_rate_limited' });
    expect((await raw('hackernews', '45000002')).status).toBe('new');
    expect(await pipeline.processOne((await raw('hackernews', '45000002')).id)).toEqual({ result: 'filtered', reason: 'hn_not_remote' });

    const bodies: any[] = [];
    ai.useChat(async (body) => {
      bodies.push(body);
      return {
        status: 200,
        headers: new Headers(),
        json: {
          choices: [{ message: { content: JSON.stringify({
            is_job: true, title: 'Backend Engineer', company: 'Paystackish', employment_type: 'full_time', remote: true,
            location_text: 'REMOTE (Africa)', countries: [], regions: ['africa'], worldwide: false, pay_min: null, pay_max: null,
            pay_currency: null, pay_period: null, apply_email: 'jobs@paystackish.example', apply_url: null, deadline: null,
            summary: 'Backend role building payments.', skills: ['go', 'postgres'],
          }) } }],
          usage: { prompt_tokens: 410, completion_tokens: 220 },
        },
      };
    });
    await db.query(`UPDATE raw_postings SET process_after = NULL WHERE id = $1`, [r.id]);
    // Other test files may use the same day's counters, so compare before and after.
    const totals = async () => (await db.query(`SELECT coalesce(sum(reserved_tokens), 0)::int AS reserved, coalesce(sum(used_input_tokens), 0)::int AS input, coalesce(sum(used_output_tokens), 0)::int AS output, coalesce(sum(requests), 0)::int AS requests FROM ai_usage_daily WHERE task = 'job_extract'`)).rows[0];
    const before = await totals();
    const callsBefore = (await db.query(`SELECT count(*)::int AS n FROM ai_calls WHERE task = 'job_extract' AND status = 'ok'`)).rows[0].n;
    expect(await pipeline.processOne(r.id)).toMatchObject({ result: 'created', status: 'live' });
    expect(bodies[0]).toMatchObject({ model: 'openai/gpt-oss-20b', reasoning_effort: 'low', response_format: { type: 'json_object' } });

    const j = await job(`company_name = 'Paystackish'`);
    expect(j).toMatchObject({ title: 'Backend Engineer', apply_method: 'email', apply_email: 'jobs@paystackish.example', allowed_regions: ['africa'], summary: 'Backend role building payments.', employment_type: 'full_time' });
    const after = await totals();
    expect({ reserved: after.reserved - before.reserved, input: after.input - before.input, output: after.output - before.output, requests: after.requests - before.requests })
      .toEqual({ reserved: 0, input: 410, output: 220, requests: 1 });
    expect((await db.query(`SELECT count(*)::int AS n FROM ai_calls WHERE task = 'job_extract' AND status = 'ok'`)).rows[0].n).toBe(callsBefore + 1);
  });

  it('waits for tomorrow when the day\'s AI budget is spent', async () => {
    await db.query(`UPDATE ai_task_budgets SET daily_tokens = 700 WHERE task = 'job_extract'`);
    try {
      const id = await addRaw('hackernews', '45000099', { id: 45000099, text: 'Acme | Support | REMOTE | worldwide. Email help@acme.example to apply for this role.', created_at: '2026-11-01T16:00:00.000Z' });
      const out = await pipeline.processOne(id);
      expect(out).toMatchObject({ result: 'deferred', reason: 'ai_budget' });
      const until = (out as { until: Date }).until;
      expect(until.getUTCHours()).toBe(0);
      expect(until.getTime()).toBeGreaterThan(Date.now());
      expect((await db.query(`SELECT waiting FROM ai_waiting`)).rows[0].waiting).toBe(1);
    } finally {
      await db.query(`UPDATE ai_task_budgets SET daily_tokens = 100000 WHERE task = 'job_extract'`);
    }
  });

  it('expires jobs and closes dead links after two failed checks', async () => {
    await ingest.fetchUnit({ sourceKey: 'remotive', boardId: null });
    await pipeline.processBatch();
    const j = await job(`title = 'Support Hero'`);
    expect(j).toMatchObject({ status: 'live', primary_source_key: 'remotive' });

    http.useFetch((async (u: string | URL | Request) => (String(u).includes('support-hero') ? new Response('gone', { status: 404 }) : new Response('<html>ok</html>'))) as typeof fetch);
    await upkeep.checkLinks(500);
    expect(await job(`id = $1`, [j.id])).toMatchObject({ status: 'live', link_failures: 1 });
    await db.query(`UPDATE job_link_checks SET checked_at = now() - interval '4 days' WHERE job_id = $1`, [j.id]);
    await upkeep.checkLinks(500);
    expect(await job(`id = $1`, [j.id])).toMatchObject({ status: 'expired', closed_reason: 'link_dead' });
    http.useFetch(fakeFetch());

    const live = await job(`title = 'QA Engineer'`);
    await db.query(`UPDATE jobs SET expires_at = now() - interval '1 minute' WHERE id = $1`, [live.id]);
    expect(await upkeep.expire()).toBe(1);
    expect(await job(`id = $1`, [live.id])).toMatchObject({ status: 'expired', closed_reason: 'expired' });
  });

  it('schedules only what is due, never twice, and switches off broken boards', async () => {
    const handlers = ctx.get(JobHandlers);
    const units = await ingest.dueUnits();
    // Fetched moments ago: not due. Credentials missing (Jooble): not due. Disabled sources: not due.
    expect(units.find((u) => u.boardId === boards.greenhouse)).toBeUndefined();
    // Seeded starter boards have never been fetched, so they are due.
    expect(units.filter((u) => u.sourceKey === 'greenhouse').length).toBeGreaterThan(0);
    expect(units.find((u) => u.sourceKey === 'jooble')).toBeUndefined();
    expect(units.find((u) => u.sourceKey === 'weworkremotely')).toBeUndefined();
    expect(units.find((u) => u.sourceKey === 'jobicy')).toBeDefined();

    const first = await handlers.tick();
    const second = await handlers.tick();
    expect(first.queued).toBeGreaterThan(0);
    expect(second.queued).toBe(0);

    const broken = (await db.query(`INSERT INTO source_boards (source_key, board_token) VALUES ('greenhouse', 'no-such-board') RETURNING id`)).rows[0].id;
    for (let i = 0; i < 5; i++) await ingest.fetchUnit({ sourceKey: 'greenhouse', boardId: broken });
    const b = (await db.query(`SELECT enabled, consecutive_failures, last_status FROM source_boards WHERE id = $1`, [broken])).rows[0];
    expect(b).toMatchObject({ enabled: false, consecutive_failures: 5 });
    expect(b.last_status).toMatch(/HTTP 404/);
    const health = (await db.query(`SELECT * FROM source_health WHERE key = 'greenhouse'`)).rows[0];
    expect(health).toMatchObject({ last_run_ok: false, failures_in_a_row: 5 });
  });
});

import { execFileSync } from 'node:child_process';
import { createHmac, createSign, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiService } from '../src/ai/ai.service';
import { ApplyService } from '../src/applying/apply.service';
import { HooksController } from '../src/applying/hooks.controller';
import { InboundService } from '../src/applying/inbound.service';
import { PlannerService } from '../src/applying/planner.service';
import { SenderService } from '../src/applying/sender.service';
import { SnsMessage, SnsVerifier, stringToSign } from '../src/applying/sns';
import { CONFIG } from '../src/config/config';
import { StorageService } from '../src/storage/storage.service';
import { INBOUND_SECRET, SITE_KEYS } from './env';
import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';

const TAG = `za${Date.now().toString(36)}`;
const CV = readFileSync(join(__dirname, 'fixtures/cv/cv.pdf'));

describe('Applying', () => {
  let ctx: TestCtx;
  let ai: AiService;
  let member: Awaited<ReturnType<typeof signIn>>;
  let site: Record<string, string>;
  let paragraph = 'In three years at Paylite I answered 60 tickets a day in Zendesk.';
  const jobs: Record<string, string> = {};
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;
  const appFor = async (jobId: string) => (await q(`SELECT * FROM applications WHERE user_id = $1 AND job_id = $2`, [member.userId, jobId]))[0];

  async function addJob(name: string, o: { email?: string | null; method?: string; trust?: string; score: number; skills?: string[] }) {
    const rawId = randomUUID();
    await q(`INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ($1::uuid, 'greenhouse', $1::text, '{}', 'x', 'extracted')`, [rawId]);
    const method = o.method ?? 'email';
    const id = (await q(
      `INSERT INTO jobs (title, company_name, description, location_scope, is_remote, skills, apply_method, apply_email, apply_url, primary_source_key, trust, status, expires_at, employment_type)
       VALUES ($1, $2, $3, 'worldwide', true, $4, $5, $6, $7, 'greenhouse', $8, 'live', now() + interval '20 days', 'full_time') RETURNING id`,
      [`${name} ${TAG}`, `${name} Co`, `${name}: support our customers with Zendesk. ${TAG}`, o.skills ?? ['zendesk'], method,
        method === 'email' ? (o.email ?? `jobs@${name.toLowerCase()}.example`) : null, method === 'email' ? null : `https://${name.toLowerCase()}.example/apply`, o.trust ?? 'careers_page'],
    ))[0].id;
    await q(`INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ($1, $2, 'greenhouse', true)`, [id, rawId]);
    await q(`INSERT INTO matches (user_id, job_id, score) VALUES ($1, $2, $3)`, [member.userId, id, o.score]);
    jobs[name] = id;
    return id;
  }

  beforeAll(async () => {
    ctx = await startApp();
    ai = ctx.app.get(AiService);
    member = await signIn(ctx);
    const ext = `rh-ap-${member.userId.slice(0, 8)}`;
    await q(`INSERT INTO site_accounts (site_id, user_id, external_user_id) SELECT id, $1, $2 FROM sites WHERE slug = 'remote-hustle'`, [member.userId, ext]);
    site = { 'X-Site-Key': SITE_KEYS['remote-hustle'], 'X-Site-User': ext };

    await ctx.http().patch('/v1/me').set(member.auth).send({ full_name: 'Ada Okafor', date_of_birth: '1998-04-02' }).expect(200);
    await ctx.http().patch('/v1/me/profile').set(member.auth).send({
      headline: 'Customer Support Specialist', country: 'NG', city: 'Lagos', timezone: 'Africa/Lagos', years_experience: 3,
      skills: ['Zendesk', 'Live chat'], experience: [{ title: 'Support Agent', company: 'Paylite', highlights: ['Answered 60 tickets a day'] }],
    }).expect(200);
    const cvKey = `cv/${member.userId}/test.pdf`;
    await ctx.app.get(StorageService).put(cvKey, CV, 'application/pdf');
    await q(`UPDATE profiles SET cv_file_key = $2 WHERE user_id = $1`, [member.userId, cvKey]);
    await ctx.http().post('/v1/me/profile/confirm').set(member.auth).expect(200);
    for (const purpose of ['matching', 'autopilot']) {
      await ctx.http().post('/v1/me/consents').set(member.auth).send({ purpose, granted: true, policy_version: '2026-11' }).expect(201);
    }
    await ctx.http().put('/v1/me/autopilot').set(site).send({ enabled: true, min_match: 70, regions: ['worldwide'], daily_cap: 2 }).expect(200);

    await addJob('Alpha', { score: 92 });
    await addJob('Bravo', { score: 88 });
    await addJob('Charlie', { score: 85 }); // over today's cap of 2
    await addJob('Delta', { method: 'external_link', score: 75 });
    await addJob('Echo', { trust: 'unverified', score: 74 });
    await addJob('Foxtrot', { score: 65 }); // under the member's 70
  });
  afterAll(() => ctx.close());
  beforeEach(() => flushRateLimits(ctx));

  it('apply pack without AI: profile answers, the CV and where to apply', async () => {
    const res = await ctx.http().post(`/v1/me/queue/${jobs.Delta}/pack`).set(site).expect(200);
    expect(res.body).toMatchObject({ job_id: jobs.Delta, open_url: 'https://delta.example/apply', tailored_cv_url: expect.stringContaining('downloads.invalid') });
    expect(res.body.answers[1].draft).toContain('Support Agent at Paylite');
  });

  it('plans: autopilot up to the daily cap, the rest into the queue with a reason', async () => {
    const out = await ctx.app.get(PlannerService).planMember(member.userId);
    expect(out).toEqual({ scheduled: 2, queued: 3 });
    const a = await appFor(jobs.Alpha);
    expect(a).toMatchObject({ mode: 'autopilot', channel: 'email_relay', status: 'scheduled', employer_key: 'alpha.example' });
    expect(new Date(a.cancel_until).getTime()).toBeGreaterThan(Date.now() + 1.9 * 3600_000);
    expect(await appFor(jobs.Charlie)).toBeUndefined();

    const relay = (await q(`SELECT local_part, domain FROM relay_addresses WHERE user_id = $1`, [member.userId]))[0];
    expect(`${relay.local_part}@${relay.domain}`).toMatch(/^ada\.[0-9a-f]{6}@apply\.ijobs\.example$/);

    const queue = (await ctx.http().get('/v1/me/queue').set(site).expect(200)).body.items;
    const reasons = Object.fromEntries(queue.filter((i: any) => i.job.title.endsWith(TAG)).map((i: any) => [i.job.title.split(' ')[0], i.why_in_queue]));
    expect(reasons).toEqual({ Delta: 'outside_rules', Echo: 'unverified_employer', Foxtrot: 'outside_rules' });
    expect(queue.find((i: any) => i.job.id === jobs.Echo).warning).toMatch(/couldn't confirm/);
    expect(queue.find((i: any) => i.job.id === jobs.Delta).pack_ready).toBe(true);
    expect((await ctx.http().get('/v1/me/queue').set(member.auth).expect(403)).body.code).toBe('membership_inactive');
  });

  it('the member can cancel within the window', async () => {
    const b = await appFor(jobs.Bravo);
    const res = await ctx.http().post(`/v1/applications/${b.id}/cancel`).set(member.auth).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancel_until: null });
    expect((await ctx.http().post(`/v1/applications/${b.id}/cancel`).set(member.auth).expect(409)).body.code).toBe('cancel_window_closed');
    expect((await q(`SELECT status, queue_reason FROM matches WHERE user_id = $1 AND job_id = $2`, [member.userId, jobs.Bravo]))[0]).toEqual({ status: 'in_queue', queue_reason: 'outside_rules' });
  });

  it('sends: limits, a checked paragraph, the CV, the record and a check-in', async () => {
    const a = await appFor(jobs.Alpha);
    await q(`UPDATE applications SET scheduled_for = now() - interval '1 minute' WHERE id = $1`, [a.id]);
    const bodies: any[] = [];
    ai.useChat(async (body: any) => {
      bodies.push(body);
      const content = body.response_format && body.messages[0].content.includes('one short paragraph') ? JSON.stringify({ paragraph }) : '{}';
      return { status: 200, headers: new Headers(), json: { choices: [{ message: { content } }], usage: { prompt_tokens: 500, completion_tokens: 120 } } };
    });
    expect(await ctx.app.get(SenderService).sendOne(a.id)).toBe('sent');
    expect(bodies[0].model).toBe('openai/gpt-oss-120b');

    const sent = ctx.mail.rawOutbox.at(-1)!;
    expect(sent.to).toBe('jobs@alpha.example');
    expect(sent.configurationSet).toBe('ijobs-relay');
    expect(sent.raw).toMatch(/^From: "Ada Okafor" <ada\.[0-9a-f]{6}@apply\.ijobs\.example>/);
    expect(sent.raw).toContain(CV.toString('base64').slice(0, 60));
    expect(sent.raw).toContain(`X-Ijobs-Application: ${a.id}`);

    const after = await appFor(jobs.Alpha);
    expect(after).toMatchObject({ status: 'sent', claims_checked: true });
    expect(after.content.body).toContain(paragraph);
    expect(after.content.attachments).toEqual(['Ada_Okafor_CV.pdf']);
    expect((await q(`SELECT autopilot_sent FROM jobs WHERE id = $1`, [jobs.Alpha]))[0].autopilot_sent).toBe(1);
    expect((await q(`SELECT count FROM send_counters WHERE scope = 'user' AND scope_key = $1`, [member.userId]))[0].count).toBe(1);
    const checkin = (await q(`SELECT ask_on FROM outcome_checkins WHERE application_id = $1`, [a.id]))[0];
    expect(Math.round((new Date(checkin.ask_on).getTime() - Date.now()) / 86400_000)).toBeGreaterThanOrEqual(9);

    const detail = (await ctx.http().get(`/v1/applications/${a.id}`).set(member.auth).expect(200)).body;
    expect(detail.sent_copy).toMatchObject({ to: 'jobs@alpha.example', subject: `Application for Alpha ${TAG} – Ada Okafor` });
    expect(detail.events.map((e: any) => e.status)).toEqual(expect.arrayContaining(['sending', 'sent']));
  });

  it('drops a paragraph that claims what the profile does not show, and still sends', async () => {
    paragraph = 'I have 9 years of Intercom experience.';
    const id = await addJob('Golf', { score: 95, skills: ['zendesk', 'intercom'] });
    await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, scheduled_for, cancel_until, relay_address_id, employer_key)
             SELECT $1, $2, site_id, 'autopilot', 'email_relay', 'scheduled', now(), now(), relay_address_id, 'golf.example' FROM applications WHERE user_id = $1 LIMIT 1`, [member.userId, id]);
    const app = await appFor(id);
    expect(await ctx.app.get(SenderService).sendOne(app.id)).toBe('sent');
    const after = await appFor(id);
    expect(after.claims_checked).toBe(false);
    expect(after.content.body).not.toContain('Intercom');
  });

  it('daily limits are all-or-none and move the send to tomorrow; the job cap sends it to the queue', async () => {
    const config = ctx.app.get(CONFIG);
    const sender = ctx.app.get(SenderService);
    const userCount = async () => (await q(`SELECT count FROM send_counters WHERE scope = 'user' AND scope_key = $1`, [member.userId]))[0].count;
    const before = await userCount();

    const hotel = await addJob('Hotel', { score: 90, email: 'jobs@alpha.example' }); // same employer as Alpha
    await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, scheduled_for, cancel_until, relay_address_id, employer_key)
             SELECT $1, $2, site_id, 'autopilot', 'email_relay', 'scheduled', now(), now(), relay_address_id, 'alpha.example' FROM applications WHERE user_id = $1 LIMIT 1`, [member.userId, hotel]);
    const prev = config.EMPLOYER_DAILY_LIMIT;
    config.EMPLOYER_DAILY_LIMIT = 1;
    try {
      expect(await sender.sendOne((await appFor(hotel)).id)).toBe('rescheduled');
    } finally {
      config.EMPLOYER_DAILY_LIMIT = prev;
    }
    const h = await appFor(hotel);
    expect(h.status).toBe('scheduled');
    expect(new Date(h.scheduled_for).getUTCHours()).toBe(7);
    expect(await userCount()).toBe(before);
    expect((await q(`SELECT autopilot_sent FROM jobs WHERE id = $1`, [hotel]))[0].autopilot_sent).toBe(0);

    await q(`UPDATE jobs SET autopilot_cap = 0 WHERE id = $1`, [hotel]);
    await q(`UPDATE applications SET scheduled_for = now() WHERE job_id = $1`, [hotel]);
    expect(await sender.sendOne(h.id)).toBe('failed');
    expect((await appFor(hotel)).failed_reason).toBe('job_cap_reached');
    expect((await q(`SELECT status, queue_reason FROM matches WHERE user_id = $1 AND job_id = $2`, [member.userId, hotel]))[0]).toEqual({ status: 'in_queue', queue_reason: 'job_cap_reached' });
  });

  it('stops if the member withdraws consent before sending', async () => {
    const india = await addJob('India', { score: 90 });
    await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, scheduled_for, cancel_until, relay_address_id, employer_key)
             SELECT $1, $2, site_id, 'autopilot', 'email_relay', 'scheduled', now(), now(), relay_address_id, 'india.example' FROM applications WHERE user_id = $1 LIMIT 1`, [member.userId, india]);
    await ctx.http().post('/v1/me/consents').set(member.auth).send({ purpose: 'autopilot', granted: false, policy_version: '2026-11' }).expect(201);
    // Withdrawing consent cancels what was waiting.
    expect((await appFor(india)).status).toBe('cancelled');
    await ctx.http().post('/v1/me/consents').set(member.auth).send({ purpose: 'autopilot', granted: true, policy_version: '2026-11' }).expect(201);
  });

  describe('replies', () => {
    const sign = (body: string) => `sha256=${createHmac('sha256', INBOUND_SECRET).update(body).digest('hex')}`;
    const post = (payload: object, signature?: string) => {
      const body = JSON.stringify(payload);
      return ctx.http().post('/v1/hooks/inbound-email').set('Content-Type', 'application/json').set('X-Ijobs-Signature', signature ?? sign(body)).send(body);
    };
    let relay: string;
    beforeAll(async () => {
      const r = (await q(`SELECT local_part || '@' || domain AS a FROM relay_addresses WHERE user_id = $1`, [member.userId]))[0];
      relay = r.a;
    });

    it('refuses unsigned posts', async () => {
      expect((await post({ to: relay, from: 'x@y.example', raw_key: 'k' }, 'sha256=00').expect(401)).body.code).toBe('bad_signature');
    });

    it('matches a reply to the application, sorts it, and passes it on to the member', async () => {
      const res = await post({ to: relay, from: 'hr@alpha.example', subject: 'Re: Application', raw_key: 'inbound/x.eml', message_id: `<${TAG}@alpha.example>`, text: 'Hi Ada, we would like to schedule a call. What is your availability this week?' }).expect(202);
      expect(res.body).toEqual({ status: 'queued' });
      const msg = (await q(`SELECT id, application_id FROM email_messages WHERE provider_message_id = $1`, [`<${TAG}@alpha.example>`]))[0];
      expect(msg.application_id).toBe((await appFor(jobs.Alpha)).id);
      expect(await ctx.app.get(InboundService).sort(msg.id)).toBe('interview');

      expect(await appFor(jobs.Alpha)).toMatchObject({ status: 'interview', last_reply_class: 'interview' });
      const fwd = ctx.mail.outbox.at(-1)!;
      expect(fwd).toMatchObject({ to: member.email, replyTo: 'hr@alpha.example' });
      expect(fwd.text).toContain('What is your availability');
      expect((await q(`SELECT type FROM notifications WHERE user_id = $1 AND type = 'application.reply'`, [member.userId]))).toHaveLength(1);
      // The same message twice is stored once.
      await post({ to: relay, from: 'hr@alpha.example', raw_key: 'inbound/x.eml', message_id: `<${TAG}@alpha.example>` }).expect(202);
      expect(await q(`SELECT id FROM email_messages WHERE provider_message_id = $1`, [`<${TAG}@alpha.example>`])).toHaveLength(1);
    });

    it('reads the raw message when the worker sent no text', async () => {
      const key = `inbound/${TAG}.eml`;
      await ctx.app.get(StorageService).put(key, Buffer.from('Subject: Re\r\nContent-Type: text/plain\r\n\r\nUnfortunately we will not be moving forward.\r\n'), 'message/rfc822');
      await post({ to: relay, from: 'talent@golf.example', subject: 'Your application', raw_key: key }).expect(202);
      const msg = (await q(`SELECT id FROM email_messages WHERE raw_key = $1`, [key]))[0];
      expect(await ctx.app.get(InboundService).sort(msg.id)).toBe('rejection');
      expect((await appFor(jobs.Golf)).status).toBe('rejected');
    });

    it('ignores mail to unknown relay addresses', async () => {
      await post({ to: 'nobody.000000@apply.ijobs.example', from: 'x@y.example', raw_key: 'k' }).expect(202);
    });
  });

  it('SES bounces suppress the address and fail the application (signed SNS only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sns-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=sns'], { stdio: 'ignore' });
    const key = readFileSync(join(dir, 'k.pem'), 'utf8');
    (ctx.app.get(HooksController) as unknown as { sns: SnsVerifier }).sns = new SnsVerifier(async () => readFileSync(join(dir, 'c.pem'), 'utf8'));

    const golf = await appFor(jobs.Golf);
    await q(`UPDATE applications SET status = 'sent' WHERE id = $1`, [golf.id]);
    const sesId = (await q(`SELECT provider_message_id FROM email_messages WHERE application_id = $1 AND direction = 'outbound'`, [golf.id]))[0].provider_message_id;
    const m: SnsMessage = {
      Type: 'Notification', MessageId: randomUUID(), TopicArn: 'arn:aws:sns:eu-west-1:1:ses', Timestamp: new Date().toISOString(), SignatureVersion: '2', Signature: '',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
      Message: JSON.stringify({ eventType: 'Bounce', mail: { messageId: sesId }, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'jobs@golf.example' }] } }),
    };
    m.Signature = createSign('RSA-SHA256').update(stringToSign(m)).sign(key, 'base64');

    await ctx.http().post('/v1/hooks/ses').set('Content-Type', 'text/plain').send(JSON.stringify({ ...m, Message: m.Message.replace('Permanent', 'Transient') })).expect(401);
    const res = await ctx.http().post('/v1/hooks/ses').set('Content-Type', 'text/plain; charset=UTF-8').send(JSON.stringify(m)).expect(200);
    expect(res.body).toEqual({ status: 'bounce' });
    expect(await q(`SELECT reason FROM email_suppressions WHERE address = 'jobs@golf.example'`)).toEqual([{ reason: 'bounce' }]);
    expect(await appFor(jobs.Golf)).toMatchObject({ status: 'failed', failed_reason: 'employer_address_bounced' });
  });

  it('apply pack with AI: queued, then built from checked answers', async () => {
    await q(`DELETE FROM apply_packs WHERE user_id = $1`, [member.userId]);
    ai.useChat(async () => ({
      status: 200, headers: new Headers(),
      json: { choices: [{ message: { content: JSON.stringify({ answers: [
        { question: 'Why this role?', draft: 'I have supported customers in Zendesk at Paylite and enjoy live chat support work every day.' },
        { question: 'Biggest result?', draft: 'I grew revenue by 300% with Intercom campaigns across five markets for my employer.' },
      ] }) } }], usage: { prompt_tokens: 800, completion_tokens: 300 } },
    }));
    const queued = await ctx.http().post(`/v1/me/queue/${jobs.Delta}/pack`).set(site).expect(202);
    expect(queued.body).toMatchObject({ kind: 'apply_pack', status: 'queued' });
    expect(await ctx.app.get(ApplyService).buildPack(queued.body.work_id)).toBe('done');
    const pack = (await ctx.http().post(`/v1/me/queue/${jobs.Delta}/pack`).set(site).expect(200)).body;
    expect(pack.answers).toEqual([{ question: 'Why this role?', draft: expect.stringContaining('Zendesk at Paylite') }]);
  });

  it('marking a job applied, the list with totals, and check-ins', async () => {
    const res = await ctx.http().post(`/v1/me/queue/${jobs.Delta}/applied`).set(site).expect(201);
    expect(res.body).toMatchObject({ mode: 'apply_queue', channel: 'external', status: 'sent' });
    expect((await ctx.http().post(`/v1/me/queue/${jobs.Delta}/applied`).set(site).expect(409)).body.code).toBe('already_applied');

    const list = (await ctx.http().get('/v1/me/applications?limit=50').set(member.auth).expect(200)).body;
    expect(list.totals).toMatchObject({ sent: expect.any(Number), interviews: 1, in_queue: expect.any(Number) });
    expect(list.items.find((i: any) => i.job.id === jobs.Alpha).last_reply).toBe('interview');
    const onlyInterviews = (await ctx.http().get('/v1/me/applications?status=interview').set(member.auth).expect(200)).body.items;
    expect(onlyInterviews.map((i: any) => i.job.id)).toEqual([jobs.Alpha]);

    await q(`UPDATE outcome_checkins SET ask_on = current_date WHERE application_id = $1`, [res.body.id]);
    const asked = await ctx.app.get(ApplyService).checkins();
    expect(asked.asked).toBeGreaterThanOrEqual(1);
    const app = (await ctx.http().get(`/v1/applications/${res.body.id}`).set(member.auth).expect(200)).body;
    expect(app.open_checkin).toMatchObject({ question: `Did you hear back from Delta Co?` });
    const answered = await ctx.http().post(`/v1/applications/${res.body.id}/checkins/${app.open_checkin.id}`).set(member.auth).send({ answer: 'interview' }).expect(200);
    expect(answered.body).toMatchObject({ status: 'interview', open_checkin: null });

    const alpha = await appFor(jobs.Alpha);
    const c = (await q(`SELECT id FROM outcome_checkins WHERE application_id = $1`, [alpha.id]))[0];
    expect((await ctx.http().post(`/v1/applications/${alpha.id}/checkins/${c.id}`).set(member.auth).send({ answer: 'did_not_apply' }).expect(422)).body.code).toBe('answer_not_possible');

    const summary = (await ctx.http().get('/v1/me/applications/summary').set(member.auth).expect(200)).body;
    expect(summary.sent.map((a: any) => a.job.id)).toEqual(expect.arrayContaining([jobs.Alpha]));
  });

  describe('visitors', () => {
    const key = { 'X-Site-Key': SITE_KEYS.school1 };
    const code = async (email: string, device = 'device-aaaaaaaa') => {
      await ctx.http().post('/v1/visitor/codes').set(key).send({ email, device_hash: device, ip: '102.89.1.1' }).expect(204);
      return ctx.mail.outbox.filter((m) => m.to === email).at(-1)!.text.match(/\b(\d{6})\b/)![1];
    };

    it('blocks throwaway emails and too many new emails from one device', async () => {
      expect((await ctx.http().post('/v1/visitor/codes').set(key).send({ email: 'x@mailinator.com', device_hash: 'device-bbbbbbbb' }).expect(422)).body.code).toBe('disposable_email');
      for (const n of [1, 2, 3]) await code(`v${n}.${TAG}@example.com`, 'device-cccccccc');
      expect((await ctx.http().post('/v1/visitor/codes').set(key).send({ email: `v4.${TAG}@example.com`, device_hash: 'device-cccccccc' }).expect(422)).body.code).toBe('device_limit');
      // A known email from the same device is fine.
      await code(`v1.${TAG}@example.com`, 'device-cccccccc');
    });

    it('counts free applies, never for sources that forbid sign-up gates, then asks to sign up', async () => {
      const email = `free.${TAG}@example.com`;
      const c = await code(email, 'device-dddddddd');
      expect((await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c === '000000' ? '111111' : '000000', job_id: jobs.Echo }).expect(401)).body.code).toBe('code_invalid');

      const first = await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c, job_id: jobs.Echo }).expect(200);
      expect(first.body).toEqual({ apply_url: 'mailto:jobs@echo.example?subject=Application%20for%20Echo%20' + TAG, applies_left: 2, credit: null });

      // A Remotive job: shown, never counted.
      const rawId = randomUUID();
      await q(`INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ($1::uuid, 'remotive', $1::text, '{}', 'x', 'extracted')`, [rawId]);
      const remotive = (await q(`INSERT INTO jobs (title, company_name, description, apply_method, apply_url, primary_source_key, status, expires_at) VALUES ('R', 'R', 'R job description long enough', 'external_link', 'https://example.com/x', 'remotive', 'live', now() + interval '5 days') RETURNING id`))[0].id;
      await q(`INSERT INTO job_sources (job_id, raw_posting_id, source_key, apply_url, is_primary) VALUES ($1, $2, 'remotive', 'https://remotive.com/remote-jobs/x', true)`, [remotive, rawId]);
      const r = await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c, job_id: remotive }).expect(200);
      expect(r.body).toEqual({ apply_url: 'https://remotive.com/remote-jobs/x', applies_left: 2, credit: 'via Remotive' });

      await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c, job_id: jobs.Echo }).expect(200);
      await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c, job_id: jobs.Echo }).expect(200);
      expect((await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c, job_id: jobs.Echo }).expect(403)).body.code).toBe('signup_required');
      await ctx.http().post('/v1/visitor/applies').set(key).send({ email, code: c, job_id: remotive }).expect(200);
    });
  });
});

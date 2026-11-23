import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { AiService } from '../src/ai/ai.service';
import { assertPublicHttpsUrl, isPrivateAddress, resolvesPublic } from '../src/common/safe-url';
import { SecretBox } from '../src/common/secretbox';
import { AtsKeyChecker } from '../src/employers/ats-check';
import { EmployersService, sameOrganisation } from '../src/employers/employers.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { eventId, retryDelayMs, signature, WebhooksService } from '../src/partner/webhooks.service';
import { DataRequestsService } from '../src/privacy/data-requests.service';
import { MailService } from '../src/messaging/mail.service';
import { RedisService } from '../src/redis/redis.service';
import { StorageService } from '../src/storage/storage.service';
import { WorkerModule } from '../src/worker.module';
import { SITE_KEYS } from './env';
import { flushRateLimits, lastCode, signIn, startApp, TestCtx, uniqueEmail } from './helpers';

const TAG = Date.now().toString(36);

describe('Platform units', () => {
  it('blocks private, loopback and metadata addresses', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.0.1', '100.64.0.9', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '102.89.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
    expect(() => assertPublicHttpsUrl('http://hooks.example.com')).toThrow();
    expect(() => assertPublicHttpsUrl('https://localhost/x')).toThrow();
    expect(() => assertPublicHttpsUrl('https://10.0.0.5/x')).toThrow();
    expect(() => assertPublicHttpsUrl('https://user:pw@hooks.example.com/x')).toThrow();
    expect(assertPublicHttpsUrl('https://hooks.example.com/ijobs').hostname).toBe('hooks.example.com');
  });

  it('re-checks DNS at send time', async () => {
    expect(await resolvesPublic('hooks.example.com', async () => ['93.184.216.34'])).toBe(true);
    expect(await resolvesPublic('rebind.example.com', async () => ['93.184.216.34', '10.0.0.8'])).toBe(false);
    expect(await resolvesPublic('gone.example.com', async () => { throw new Error('ENOTFOUND'); })).toBe(false);
  });

  it('signs webhooks the way the docs say, with stable event ids and capped backoff', () => {
    const body = '{"a":1}';
    expect(signature('whsec_x', body, 1_700_000_000)).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update(`1700000000.${body}`).digest('hex')}`);
    expect(eventId('match.created', 'u:j')).toBe(eventId('match.created', 'u:j'));
    expect(eventId('match.created', 'u:j')).not.toBe(eventId('work.ready', 'u:j'));
    expect(eventId('x', 'y')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([1, 2, 3, 20].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 7_200_000]);
  });

  it('keeps secrets sealed and refuses tampering', () => {
    const box = new SecretBox('a-long-test-secret-key-0123456789abcdef');
    const sealed = box.seal('lever_key_1234');
    expect(sealed.toString('utf8')).not.toContain('lever_key');
    expect(box.open(sealed)).toBe('lever_key_1234');
    sealed[sealed.length - 1] ^= 1;
    expect(() => box.open(sealed)).toThrow();
    expect(() => new SecretBox('another-long-secret-key-0123456789abcd').open(box.seal('x'))).toThrow();
  });

  it('matches company email domains to websites', () => {
    expect(sameOrganisation('acme.com', 'www.acme.com')).toBe(true);
    expect(sameOrganisation('ng.acme.com', 'acme.com')).toBe(true);
    expect(sameOrganisation('acme.com', 'careers.acme.com')).toBe(true);
    expect(sameOrganisation('acme.com', 'acme.co')).toBe(false);
    expect(sameOrganisation('notacme.com', 'acme.com')).toBe(false);
  });
});

describe('Platform: notifications, help, moderation, partners, employers, data', () => {
  let ctx: TestCtx;
  let worker: INestApplicationContext;
  let member: Awaited<ReturnType<typeof signIn>>;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let staff: Awaited<ReturnType<typeof signIn>>;
  let ijobsSite: string;
  let rhSite: string;
  let viaRh: Record<string, string>;
  let communityId: string;
  const rhKey = { 'X-Site-Key': SITE_KEYS['remote-hustle'] };
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;
  const answer = (content: unknown) => async () => ({ status: 200, headers: new Headers(), json: { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 300, completion_tokens: 80 } } });

  async function addJob(o: { status?: string; communityId?: string | null; description?: string } = {}) {
    const rawId = randomUUID();
    await q(`INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ($1::uuid, 'greenhouse', $1::text, '{}', 'x', 'extracted')`, [rawId]);
    const id = (await q(
      `INSERT INTO jobs (title, company_name, description, location_scope, is_remote, apply_method, apply_email, primary_source_key, trust, status, expires_at, community_id)
       VALUES ($1, 'Quickcash Ltd', $2, 'worldwide', true, 'email', 'hr@quickcash.example', 'greenhouse', 'unverified', $3, now() + interval '20 days', $4) RETURNING id`,
      [`Data entry ${TAG} ${Math.random()}`, o.description ?? `Pay a registration fee to start. ${randomUUID()}`, o.status ?? 'pending_review', o.communityId ?? null],
    ))[0].id;
    await q(`INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ($1, $2, 'greenhouse', true)`, [id, rawId]);
    return id as string;
  }

  beforeAll(async () => {
    ctx = await startApp();
    worker = await (await Test.createTestingModule({ imports: [WorkerModule] }).compile()).init();
    member = await signIn(ctx);
    staff = await signIn(ctx);
    await q(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'admin')`, [staff.userId]);
    ijobsSite = (await q(`SELECT id FROM sites WHERE slug = 'ijobs'`))[0].id;
    rhSite = (await q(`SELECT id FROM sites WHERE slug = 'remote-hustle'`))[0].id;
    const ext = `rh-pl-${member.userId.slice(0, 8)}`;
    await q(`INSERT INTO site_accounts (site_id, user_id, external_user_id) VALUES ($1, $2, $3)`, [rhSite, member.userId, ext]);
    viaRh = { ...rhKey, 'X-Site-User': ext };
    owner = await signIn(ctx);
    await q(`INSERT INTO owner_profiles (user_id, legal_name, id_type, id_number_hash) VALUES ($1, 'Kemi Ade', 'nin', $2)`, [owner.userId, `h-${randomUUID()}`]);
    communityId = (await q(`INSERT INTO communities (owner_user_id, name, slug, invite_code, price_kobo, platform_share_bps, status) VALUES ($1, 'Strike Test', $2, $3, 500000, 2000, 'active') RETURNING id`, [owner.userId, `strike-${TAG}`, `STR-${TAG}`]))[0].id;
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });
  beforeEach(() => flushRateLimits(ctx));

  // ------------------------------------------------------------------ notifications

  describe('notifications', () => {
    it('members see everything on i-jobs; a partner site sees only its own', async () => {
      await q(`INSERT INTO notifications (user_id, site_id, type, title, body) VALUES ($1, $2, 'profile.ready', 'Your profile is ready', 'Check it over'), ($1, $3, 'daily_summary', 'Remote Hustle summary', null)`, [member.userId, ijobsSite, rhSite]);
      const mine = (await ctx.http().get('/v1/me/notifications').set(member.auth).expect(200)).body;
      expect(mine.unread_count).toBe(2);
      expect(mine.items.map((n: any) => n.title).sort()).toEqual(['Remote Hustle summary', 'Your profile is ready']);
      const theirs = (await ctx.http().get('/v1/me/notifications').set(viaRh).expect(200)).body;
      expect(theirs.items.map((n: any) => n.title)).toEqual(['Remote Hustle summary']);
      expect(theirs.unread_count).toBe(1);
    });

    it('marks some or all read, and pages', async () => {
      const page1 = (await ctx.http().get('/v1/me/notifications?limit=1').set(member.auth).expect(200)).body;
      expect(page1.items).toHaveLength(1);
      expect(page1.next_cursor).toBeTruthy();
      await ctx.http().post('/v1/me/notifications/read').set(member.auth).send({ ids: [page1.items[0].id] }).expect(204);
      expect((await ctx.http().get('/v1/me/notifications?unread=true').set(member.auth).expect(200)).body.items).toHaveLength(1);
      await ctx.http().post('/v1/me/notifications/read').set(member.auth).send({}).expect(204);
      expect((await ctx.http().get('/v1/me/notifications').set(member.auth).expect(200)).body.unread_count).toBe(0);
    });

    it('emails the important ones once', async () => {
      const outbox = worker.get(MailService).outbox;
      const before = outbox.length;
      const r = await worker.get(NotificationsService).deliverEmails();
      expect(r.sent).toBeGreaterThanOrEqual(1);
      const sent = outbox.slice(before).filter((m) => m.to === member.email);
      expect(sent.map((m) => m.subject)).toContain('Your profile is ready');
      expect(sent.map((m) => m.subject)).not.toContain('Remote Hustle summary'); // in-app only
      expect((await worker.get(NotificationsService).deliverEmails()).sent).toBe(0);
    });
  });

  // ------------------------------------------------------------------ help and support

  describe('help and support', () => {
    it('searches the help articles by words when there are no embeddings', async () => {
      const hits = (await ctx.http().get('/v1/help/search').query({ q: 'when do owners get paid' }).expect(200)).body;
      expect(hits[0].question).toBe('When do community owners get paid?');
      expect(hits[0].relevance).toBeGreaterThan(0);
      expect(hits[0].relevance).toBeLessThanOrEqual(1);
      await ctx.http().get('/v1/help/search').query({ q: 'x' }).expect(400);
    });

    it('answers from the FAQ without AI when it matches well', async () => {
      const res = await ctx.http().post('/v1/help/ask').set(member.auth).send({ question: 'How do I upload my CV?' }).expect(200);
      expect(res.body).toEqual({ answer: expect.stringContaining('PDF or Word'), source: 'faq', ticket_id: null });
    });

    it('sends money, scam and data questions straight to a person', async () => {
      const res = await ctx.http().post('/v1/help/ask').set(member.auth).send({ question: 'I was charged twice for my membership' }).expect(202);
      expect(res.body).toMatchObject({ kind: 'support_answer', status: 'queued', reason: 'handed_to_person', ticket_id: expect.any(String) });
      const t = (await ctx.http().get(`/v1/support/tickets/${res.body.ticket_id}`).set(member.auth).expect(200)).body;
      expect(t).toMatchObject({ category: 'payment', status: 'waiting_human', messages: [{ author: 'user', body: 'I was charged twice for my membership' }] });
    });

    it('uses the assistant only when the FAQ has nothing, and hands over when it is unsure', async () => {
      const ai = ctx.app.get(AiService);
      ai.useChat(answer({ answer: 'Turn autopilot off in your autopilot settings.', confident: true }));
      const ok = await ctx.http().post('/v1/help/ask').set(member.auth).send({ question: 'Zebra quantum gizmo settings toggle?' }).expect(200);
      expect(ok.body).toEqual({ answer: 'Turn autopilot off in your autopilot settings.', source: 'assistant', ticket_id: null });
      ai.useChat(answer({ answer: '', confident: false }));
      const unsure = await ctx.http().post('/v1/help/ask').set(member.auth).send({ question: 'Zebra quantum gizmo settings toggle?' }).expect(202);
      expect(unsure.body.ticket_id).toBeTruthy();
    });

    it('tickets: members reply, staff answer, the member is told', async () => {
      const t = (await ctx.http().post('/v1/support/tickets').set(member.auth).send({ subject: 'Profile question', message: 'My city is wrong' }).expect(201)).body;
      expect(t).toMatchObject({ subject: 'Profile question', category: 'other', status: 'waiting_human' });
      await ctx.http().post(`/v1/support/tickets/${t.id}/messages`).set(member.auth).send({ body: 'It says Abuja, I live in Lagos' }).expect(204);
      expect((await ctx.http().get('/v1/support/tickets').set(member.auth).expect(200)).body.map((x: any) => x.id)).toContain(t.id);

      const other = await signIn(ctx);
      await ctx.http().get(`/v1/support/tickets/${t.id}`).set(other.auth).expect(404);
      await ctx.http().get('/v1/admin/support/tickets').set(member.auth).expect(403);

      const queue = (await ctx.http().get('/v1/admin/support/tickets').set(staff.auth).expect(200)).body.items;
      expect(queue.map((x: any) => x.id)).toContain(t.id);
      const replied = (await ctx.http().post(`/v1/admin/support/tickets/${t.id}/messages`).set(staff.auth).send({ body: 'Fixed it for you.', resolve: true }).expect(200)).body;
      expect(replied.status).toBe('resolved');
      expect(replied.messages.map((m: any) => m.author)).toEqual(['user', 'user', 'staff']);
      const n = (await q(`SELECT type, title FROM notifications WHERE user_id = $1 AND type = 'support.reply'`, [member.userId]))[0];
      expect(n.title).toBe('Reply about: Profile question');
    });
  });

  // ------------------------------------------------------------------ moderation

  describe('moderation', () => {

    it('only moderators see the queue', async () => {
      await ctx.http().get('/v1/admin/moderation').set(member.auth).expect(403);
      await ctx.http().get('/v1/admin/moderation').expect(401);
    });

    it('approving puts a held job live', async () => {
      const jobId = await addJob({ description: `A normal support role. ${randomUUID()}` });
      const item = (await q(`INSERT INTO moderation_items (subject_type, subject_id, reason_internal, risk_score) VALUES ('job', $1, 'test', 0.4) RETURNING id`, [jobId]))[0].id;
      const list = (await ctx.http().get('/v1/admin/moderation?subject=job').set(staff.auth).expect(200)).body.items;
      expect(list.find((i: any) => i.id === item)).toMatchObject({ subject_type: 'job', risk_score: 0.4, status: 'open' });
      // Reviewers see what the job is without looking it up.
      expect(list.find((i: any) => i.id === item).subject).toMatchObject({ title: expect.stringContaining(' at '), lines: expect.arrayContaining([expect.stringMatching(/^Status: /)]), text: expect.stringContaining('normal support role') });
      expect((await ctx.http().post(`/v1/admin/moderation/${item}/decision`).set(staff.auth).send({ decision: 'approve' }).expect(200)).body.status).toBe('approved');
      expect((await q(`SELECT status FROM jobs WHERE id = $1`, [jobId]))[0].status).toBe('live');
      expect((await ctx.http().post(`/v1/admin/moderation/${item}/decision`).set(staff.auth).send({ decision: 'reject' }).expect(409)).body.code).toBe('already_decided');
    });

    it('a scam is blocked everywhere, applicants are warned, and the posting community gets a strike', async () => {
      const jobId = await addJob({ status: 'live', communityId });
      const sent = await signIn(ctx);
      const waiting = await signIn(ctx);
      const relay = async (userId: string) => (await q(`INSERT INTO relay_addresses (user_id, local_part, domain) VALUES ($1, $2, 'apply.ijobs.example') RETURNING id`, [userId, `r${randomUUID().slice(0, 12)}`]))[0].id;
      await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, sent_at, relay_address_id) VALUES ($1, $2, $3, 'manual', 'email_relay', 'sent', now(), $4)`, [sent.userId, jobId, ijobsSite, await relay(sent.userId)]);
      await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, scheduled_for, cancel_until, relay_address_id) VALUES ($1, $2, $3, 'autopilot', 'email_relay', 'scheduled', now() + interval '1 hour', now() + interval '1 hour', $4)`, [waiting.userId, jobId, ijobsSite, await relay(waiting.userId)]);
      const item = (await q(`INSERT INTO moderation_items (subject_type, subject_id, reason_internal) VALUES ('job', $1, 'reported') RETURNING id`, [jobId]))[0].id;

      await ctx.http().post(`/v1/admin/moderation/${item}/decision`).set(staff.auth).send({ decision: 'reject_as_scam', strike: true, note: 'asks for a fee' }).expect(200);
      expect((await q(`SELECT status FROM jobs WHERE id = $1`, [jobId]))[0].status).toBe('scam');
      expect((await q(`SELECT count(*)::int AS n FROM scam_signatures WHERE example_job_id = $1`, [jobId]))[0].n).toBe(1);
      expect((await q(`SELECT status FROM applications WHERE user_id = $1`, [waiting.userId]))[0].status).toBe('cancelled');
      expect((await q(`SELECT type FROM notifications WHERE user_id = $1`, [sent.userId])).map((r) => r.type)).toEqual(['job.scam_alert']);
      expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [waiting.userId]))[0].n).toBe(0); // never sent, nothing to warn about
      expect((await q(`SELECT strike_count, status FROM communities WHERE id = $1`, [communityId]))[0]).toEqual({ strike_count: 1, status: 'active' });
      expect((await q(`SELECT action FROM audit_log WHERE subject_id = $1`, [jobId])).map((r) => r.action)).toContain('moderation.reject_as_scam');
    });

    it('three strikes suspend the community and queue a ban decision', async () => {
      for (let i = 0; i < 2; i++) {
        const jobId = await addJob({ status: 'live', communityId });
        const item = (await q(`INSERT INTO moderation_items (subject_type, subject_id, reason_internal) VALUES ('job', $1, 'reported') RETURNING id`, [jobId]))[0].id;
        await ctx.http().post(`/v1/admin/moderation/${item}/decision`).set(staff.auth).send({ decision: 'reject', strike: true }).expect(200);
      }
      expect((await q(`SELECT strike_count, status FROM communities WHERE id = $1`, [communityId]))[0]).toEqual({ strike_count: 3, status: 'suspended' });
      expect((await q(`SELECT reason_internal FROM moderation_items WHERE subject_type = 'community' AND subject_id = $1`, [communityId]))[0].reason_internal).toMatch(/3 strikes/);
    });

    it('the owner sees each strike and can appeal it once', async () => {
      const strikes = (await ctx.http().get(`/v1/owner/communities/${communityId}/strikes`).set(owner.auth).expect(200)).body;
      expect(strikes).toHaveLength(3);
      expect(strikes.find((s: any) => s.reason === 'asks for a fee')).toMatchObject({ appeal: null, can_appeal: true });
      await ctx.http().post(`/v1/owner/communities/${communityId}/strikes/${strikes[0].id}/appeal`).set(owner.auth).send({ reason: 'The job was real; here is the company page.' }).expect(202);
      expect((await ctx.http().get(`/v1/owner/communities/${communityId}/strikes`).set(owner.auth).expect(200)).body[0]).toMatchObject({ appeal: 'pending', can_appeal: false });
      await ctx.http().post(`/v1/owner/communities/${communityId}/strikes/${strikes[0].id}/appeal`).set(owner.auth).send({ reason: 'Trying a second time to appeal.' }).expect(404);
      await ctx.http().get(`/v1/owner/communities/${communityId}/strikes`).set(member.auth).expect(404);
      // Upholding the appeal takes the strike back and lifts the suspension.
      const appealItem = (await q(`SELECT id FROM moderation_items WHERE reason_internal = $1`, [`strike appeal ${strikes[0].id}`]))[0].id;
      await ctx.http().post(`/v1/admin/moderation/${appealItem}/decision`).set(staff.auth).send({ decision: 'approve', note: 'Company confirmed the role' }).expect(200);
      expect((await q(`SELECT strike_count, status FROM communities WHERE id = $1`, [communityId]))[0]).toEqual({ strike_count: 2, status: 'active' });
      expect((await ctx.http().get(`/v1/owner/communities/${communityId}/strikes`).set(owner.auth).expect(200)).body[0].appeal).toBe('approved');
      // Community items describe the community for the reviewer.
      const items = (await ctx.http().get('/v1/admin/moderation?subject=community').set(staff.auth).expect(200)).body.items;
      expect(items.find((i: any) => i.subject_id === communityId).subject.title).toBe(`Strike Test (/strike-${TAG})`);
    });
  });

  // ------------------------------------------------------------------ partner users

  describe('partner users', () => {
    it('only links users whose email the partner verified', async () => {
      expect((await ctx.http().post('/v1/partner/users').set(rhKey).send({ external_user_id: `x-${TAG}`, email: uniqueEmail(), email_verified: false }).expect(422)).body.code).toBe('email_not_verified');
      await ctx.http().post('/v1/partner/users').set(member.auth).send({ external_user_id: 'x', email: uniqueEmail(), email_verified: true }).expect(401);
    });

    it('creates and links someone new to i-jobs', async () => {
      const email = uniqueEmail('rhnew');
      const res = (await ctx.http().post('/v1/partner/users').set(rhKey).send({ external_user_id: `new-${TAG}`, email, email_verified: true, full_name: 'Bisi Lawal', date_of_birth: '1999-01-05', completed_trainings: ['c-101'] }).expect(200)).body;
      expect(res).toEqual({ user_id: expect.any(String), linked: true, consent_url: null });
      expect((await q(`SELECT u.age_band, sa.completed_trainings FROM users u JOIN site_accounts sa ON sa.user_id = u.id WHERE u.id = $1`, [res.user_id]))[0]).toEqual({ age_band: 'adult', completed_trainings: ['c-101'] });
      // Calling again is harmless.
      expect((await ctx.http().post('/v1/partner/users').set(rhKey).send({ external_user_id: `new-${TAG}`, email, email_verified: true }).expect(200)).body.user_id).toBe(res.user_id);
      await ctx.http().get('/v1/me/notifications').set({ ...rhKey, 'X-Site-User': `new-${TAG}` }).expect(200);
    });

    it('asks an existing i-jobs person before linking, and tells the partner nothing until then', async () => {
      const person = await signIn(ctx);
      const res = (await ctx.http().post('/v1/partner/users').set({ 'X-Site-Key': SITE_KEYS.school1 }).send({ external_user_id: `s1-${TAG}`, email: person.email, email_verified: true }).expect(200)).body;
      expect(res).toEqual({ user_id: null, linked: false, consent_url: expect.stringMatching(/\/link\/[A-Za-z0-9_-]+$/) });
      expect(ctx.mail.outbox.at(-1)).toMatchObject({ to: person.email, subject: 'Link your i-jobs account to School1?' });
      const token = res.consent_url.split('/').pop();

      await ctx.http().get('/v1/me/profile').set({ 'X-Site-Key': SITE_KEYS.school1, 'X-Site-User': `s1-${TAG}` }).expect(404);
      await ctx.http().post(`/v1/partner/links/${token}/accept`).set(member.auth).expect(403);
      expect((await ctx.http().get(`/v1/partner/links/${token}`).set(person.auth).expect(200)).body.site).toBe('School1');
      expect((await ctx.http().post(`/v1/partner/links/${token}/accept`).set(person.auth).expect(200)).body).toEqual({ linked: true, site: 'School1' });
      await ctx.http().post(`/v1/partner/links/${token}/accept`).set(person.auth).expect(404);
      expect((await q(`SELECT granted FROM consents WHERE user_id = $1 AND purpose = 'cross_site_linking'`, [person.userId]))[0].granted).toBe(true);
      expect((await ctx.http().post('/v1/partner/users').set({ 'X-Site-Key': SITE_KEYS.school1 }).send({ external_user_id: `s1-${TAG}`, email: person.email, email_verified: true }).expect(200)).body).toEqual({ user_id: person.userId, linked: true, consent_url: null });
    });
  });

  // ------------------------------------------------------------------ webhooks

  describe('partner webhooks', () => {
    let endpoint: { id: string; secret: string };
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    let reply = 200;

    beforeAll(() => {
      const hooks = worker.get(WebhooksService);
      hooks.resolve = async (host) => (host === 'hooks.example.com' ? ['93.184.216.34'] : ['10.0.0.9']);
      hooks.fetchFn = (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
        return new Response('ok', { status: reply });
      }) as typeof fetch;
    });

    it('refuses plain http and private addresses', async () => {
      expect((await ctx.http().post('/v1/partner/webhooks').set(rhKey).send({ url: 'http://hooks.example.com/x', events: ['match.created'] }).expect(422)).body.code).toBe('https_required');
      expect((await ctx.http().post('/v1/partner/webhooks').set(rhKey).send({ url: 'https://192.168.0.10/x', events: ['match.created'] }).expect(422)).body.code).toBe('private_address');
      await ctx.http().post('/v1/partner/webhooks').set(rhKey).send({ url: 'https://hooks.example.com/x', events: ['nope'] }).expect(400);
      await ctx.http().get('/v1/partner/webhooks').set(member.auth).expect(401);
    });

    it('shows the secret once and stores it sealed', async () => {
      const res = (await ctx.http().post('/v1/partner/webhooks').set(rhKey).send({ url: 'https://hooks.example.com/ijobs', events: ['application.status_changed', 'match.created'] }).expect(201)).body;
      expect(res).toMatchObject({ url: 'https://hooks.example.com/ijobs', enabled: true, secret: expect.stringMatching(/^whsec_/) });
      endpoint = res;
      const listed = (await ctx.http().get('/v1/partner/webhooks').set(rhKey).expect(200)).body;
      expect(listed.find((e: any) => e.id === res.id)).not.toHaveProperty('secret');
      const row = (await q(`SELECT secret_ciphertext, secret_hash FROM webhook_endpoints WHERE id = $1`, [res.id]))[0];
      expect(row.secret_ciphertext.toString('utf8')).not.toContain(res.secret);
      // School1 can't see Remote Hustle's endpoints.
      expect((await ctx.http().get('/v1/partner/webhooks').set({ 'X-Site-Key': SITE_KEYS.school1 }).expect(200)).body.find((e: any) => e.id === res.id)).toBeUndefined();
    });

    it('turns changes into signed events for linked sites, once', async () => {
      const hooks = worker.get(WebhooksService);
      await worker.get(RedisService).client.del('webhooks:cursor:application.status_changed', 'webhooks:cursor:match.created');
      await hooks.collect(); // sets the cursors to "a minute ago"
      const jobId = await addJob({ status: 'live', description: `Strong match ${randomUUID()}` });
      const relayId = (await q(`INSERT INTO relay_addresses (user_id, local_part, domain) VALUES ($1, $2, 'apply.ijobs.example') RETURNING id`, [member.userId, `w${randomUUID().slice(0, 12)}`]))[0].id;
      await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, sent_at, relay_address_id) VALUES ($1, $2, $3, 'manual', 'email_relay', 'sent', now() - interval '10 seconds', $4)`, [member.userId, jobId, ijobsSite, relayId]);
      await q(`UPDATE application_events SET at = now() - interval '5 seconds' WHERE application_id IN (SELECT id FROM applications WHERE user_id = $1 AND job_id = $2)`, [member.userId, jobId]);
      await q(`INSERT INTO matches (user_id, job_id, score, computed_at) VALUES ($1, $2, 91, now() - interval '5 seconds')`, [member.userId, jobId]);

      const first = await hooks.collect();
      expect(first['application.status_changed']).toBeGreaterThanOrEqual(1);
      expect(first['match.created']).toBe(1);
      await worker.get(RedisService).client.del('webhooks:cursor:match.created');
      await hooks.collect();
      expect((await q(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE endpoint_id = $1 AND event = 'match.created'`, [endpoint.id]))[0].n).toBe(1);

      const out = await hooks.deliver();
      expect(out.delivered).toBeGreaterThanOrEqual(2);
      const match = calls.find((c) => JSON.parse(c.body).type === 'match.created')!;
      const event = JSON.parse(match.body);
      expect(event).toEqual({ id: expect.any(String), type: 'match.created', created_at: expect.any(String), site_user: viaRh['X-Site-User'], data: { job_id: jobId, score: 91 } });
      const [, t, v1] = match.headers['x-ijobs-signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
      expect(v1).toBe(createHmac('sha256', endpoint.secret).update(`${t}.${match.body}`).digest('hex'));
    });

    it('retries failures with backoff and never calls a private address', async () => {
      const hooks = worker.get(WebhooksService);
      const id = (await q(`INSERT INTO webhook_deliveries (endpoint_id, event, payload) VALUES ($1, 'match.created', '{"x":1}') RETURNING id`, [endpoint.id]))[0].id;
      reply = 500;
      await hooks.deliver();
      const row = (await q(`SELECT status, attempts, last_error, next_attempt_at > now() AS later FROM webhook_deliveries WHERE id = $1`, [id]))[0];
      expect(row).toEqual({ status: 'pending', attempts: 1, last_error: 'http_500', later: true });

      await q(`UPDATE webhook_deliveries SET next_attempt_at = now(), created_at = now() - interval '25 hours' WHERE id = $1`, [id]);
      await hooks.deliver();
      expect((await q(`SELECT status FROM webhook_deliveries WHERE id = $1`, [id]))[0].status).toBe('failed');
      reply = 200;

      // The name now points inside our network: not called.
      const before = calls.length;
      await q(`UPDATE webhook_endpoints SET url = 'https://rebound.example.com/x' WHERE id = $1`, [endpoint.id]);
      const id2 = (await q(`INSERT INTO webhook_deliveries (endpoint_id, event, payload) VALUES ($1, 'match.created', '{"x":2}') RETURNING id`, [endpoint.id]))[0].id;
      await hooks.deliver();
      expect(calls.length).toBe(before);
      expect((await q(`SELECT last_error FROM webhook_deliveries WHERE id = $1`, [id2]))[0].last_error).toBe('address_not_public');
    });

    it('deleting an endpoint drops what was waiting', async () => {
      await ctx.http().delete(`/v1/partner/webhooks/${endpoint.id}`).set({ 'X-Site-Key': SITE_KEYS.school1 }).expect(404);
      await ctx.http().delete(`/v1/partner/webhooks/${endpoint.id}`).set(rhKey).expect(204);
      expect((await q(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE endpoint_id = $1`, [endpoint.id]))[0].n).toBe(0);
    });
  });

  // ------------------------------------------------------------------ employers

  describe('employers', () => {
    let boss: Awaited<ReturnType<typeof signIn>>;
    let employerId: string;
    const domain = `acme-${TAG}.example`;
    const job = {
      title: 'Customer Support Lead',
      description: 'Lead a team of six support agents across email and chat. You will hire, coach, and own our response times. Remote, Lagos hours.',
      location_scope: 'restricted', allowed_countries: ['NG', 'GH'], employment_type: 'full_time', max_applicants: 2,
    };

    beforeAll(async () => {
      boss = await signIn(ctx, `hr.${TAG}@${domain}`);
      const svc = worker.get(EmployersService);
      svc.resolve = async () => ['93.184.216.34'];
      svc.fetchFn = (async (url: string) => (url.startsWith(`https://www.${domain}`) ? new Response('<html>Acme</html>', { status: 200 }) : new Response('', { status: 301, headers: { location: `https://www.${domain}/` } }))) as typeof fetch;
      const ats = ctx.app.get(AtsKeyChecker);
      ats.fetchFn = (async (url: string, init: RequestInit) => {
        const auth = (init.headers as Record<string, string>).authorization ?? '';
        const good = Buffer.from(auth.replace('Basic ', ''), 'base64').toString().startsWith('good-key');
        return new Response(JSON.stringify({ success: good }), { status: url.includes('lever') && !good ? 401 : 200 });
      }) as typeof fetch;
    });

    it('refuses free email providers and emails off the website domain', async () => {
      expect((await ctx.http().post('/v1/employers/verifications').set(boss.auth).send({ company_name: 'Acme', work_email: 'acme.hr@gmail.com', website_url: `https://${domain}` }).expect(422)).body.code).toBe('free_email_provider');
      expect((await ctx.http().post('/v1/employers/verifications').set(boss.auth).send({ company_name: 'Acme', work_email: `hr@other-${TAG}.example`, website_url: `https://${domain}` }).expect(422)).body.code).toBe('domain_mismatch');
    });

    it('confirms the work email with a code, then checks the website; a person checks the registry', async () => {
      const started = (await ctx.http().post('/v1/employers/verifications').set(boss.auth).send({ company_name: 'Acme Ltd', work_email: boss.email, website_url: `https://${domain}`, registry_number: 'RC123456', country: 'ng' }).expect(202)).body;
      employerId = started.employer_id;
      const code = lastCode(ctx.mail.outbox.filter((m) => m.to === boss.email).at(-1)!.text);
      expect((await ctx.http().post('/v1/employers/verifications/confirm').set(boss.auth).send({ work_email: boss.email, code: code === '000000' ? '111111' : '000000' }).expect(401)).body.code).toBe('code_invalid');
      const e = (await ctx.http().post('/v1/employers/verifications/confirm').set(boss.auth).send({ work_email: boss.email, code }).expect(200)).body;
      expect(e).toEqual({ id: employerId, name: 'Acme Ltd', domain, verification: 'pending', checks: { work_email: true, website: false, registry: false } });
      expect((await q(`SELECT reason_internal FROM moderation_items WHERE subject_type = 'employer' AND subject_id = $1`, [employerId]))[0].reason_internal).toMatch(/RC123456/);

      expect(await worker.get(EmployersService).checkWebsite(employerId)).toEqual({ ok: true });
      expect((await q(`SELECT checks->>'website' AS w, verification FROM employers WHERE id = $1`, [employerId]))[0]).toEqual({ w: 'true', verification: 'pending' });
    });

    it('lists my companies, and Me says I am an employer', async () => {
      expect((await ctx.http().get('/v1/employers/mine').set(boss.auth).expect(200)).body).toEqual([expect.objectContaining({ id: employerId, role: 'owner' })]);
      expect((await ctx.http().get('/v1/me').set(boss.auth).expect(200)).body).toMatchObject({ is_employer: true, is_staff: false, staff_role: null });
      expect((await ctx.http().get('/v1/me').set(staff.auth).expect(200)).body).toMatchObject({ is_staff: true, staff_role: 'admin' });
      const stranger = await signIn(ctx);
      expect((await ctx.http().get('/v1/employers/mine').set(stranger.auth).expect(200)).body).toEqual([]);
      expect((await ctx.http().get(`/v1/employers/${employerId}`).set(stranger.auth).expect(403)).body.code).toBe('not_employer_member');
    });

    it('jobs from an unverified employer wait for review', async () => {
      const res = (await ctx.http().post(`/v1/employers/${employerId}/jobs`).set(boss.auth).send(job).expect(201)).body;
      expect(res).toMatchObject({ title: 'Customer Support Lead', status: 'pending_review', trust: 'unverified' });
      expect((await q(`SELECT apply_method, apply_email, max_applicants, autopilot_cap FROM jobs WHERE id = $1`, [res.id]))[0]).toEqual({ apply_method: 'email', apply_email: boss.email, max_applicants: 2, autopilot_cap: 2 });
      expect((await q(`SELECT count(*)::int AS n FROM moderation_items WHERE subject_type = 'job' AND subject_id = $1`, [res.id]))[0].n).toBe(1);
      const stranger = await signIn(ctx);
      expect((await ctx.http().post(`/v1/employers/${employerId}/jobs`).set(stranger.auth).send(job).expect(403)).body.code).toBe('not_employer_member');
    });

    it('after the registry check it is verified and its jobs go live at once', async () => {
      const item = (await q(`SELECT id FROM moderation_items WHERE subject_type = 'employer' AND subject_id = $1`, [employerId]))[0].id;
      await ctx.http().post(`/v1/admin/moderation/${item}/decision`).set(staff.auth).send({ decision: 'approve', note: 'CAC record matches' }).expect(200);
      expect((await q(`SELECT verification, checks FROM employers WHERE id = $1`, [employerId]))[0]).toEqual({ verification: 'verified', checks: { work_email: true, website: true, registry: true } });
      const live = (await ctx.http().post(`/v1/employers/${employerId}/jobs`).set(boss.auth).send(job).expect(201)).body;
      expect(live).toMatchObject({ status: 'live', trust: 'verified_employer' });
      expect((await ctx.http().post(`/v1/employers/${employerId}/jobs`).set(boss.auth).send({ ...job, apply_email: 'jobs@gmail.com' }).expect(422)).body.code).toBe('apply_email_off_domain');

      // Full jobs close.
      for (let i = 0; i < 2; i++) {
        const u = await signIn(ctx);
        await q(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status) VALUES ($1, $2, $3, 'manual', 'external', 'sent')`, [u.userId, live.id, ijobsSite]);
      }
      expect((await worker.get(EmployersService).closeFullJobs()).closed).toBeGreaterThanOrEqual(1);
      expect((await q(`SELECT status, closed_reason FROM jobs WHERE id = $1`, [live.id]))[0]).toEqual({ status: 'expired', closed_reason: 'max_applicants' });
      const detail = (await ctx.http().get(`/v1/employers/${employerId}`).set(boss.auth).expect(200)).body;
      expect(detail.employer.verification).toBe('verified');
      expect(detail.jobs.find((j: any) => j.id === live.id)).toMatchObject({ state: 'closed', applicants: 2, max_applicants: 2 });
      expect(detail.jobs.some((j: any) => j.state === 'in_review')).toBe(true);
    });

    it('connects an ATS after a test call, keeps only the last four characters visible, and disconnects', async () => {
      expect((await ctx.http().post(`/v1/employers/${employerId}/integrations`).set(boss.auth).send({ provider: 'lever', board_token: `acme-${TAG}`, api_key: 'bad-key-0000' }).expect(422)).body.code).toBe('key_rejected');
      const res = (await ctx.http().post(`/v1/employers/${employerId}/integrations`).set(boss.auth).send({ provider: 'lever', board_token: `acme-${TAG}`, api_key: 'good-key-9876' }).expect(201)).body;
      expect(res).toEqual({ id: expect.any(String), provider: 'lever', board_token: `acme-${TAG}`, key_last4: '9876', connected_at: expect.any(String) });
      expect(await ctx.app.get(EmployersService).keyFor(res.id)).toBe('good-key-9876');
      expect((await q(`SELECT api_key_ciphertext FROM employer_integrations WHERE id = $1`, [res.id]))[0].api_key_ciphertext.toString()).not.toContain('good-key');
      await ctx.http().delete(`/v1/employers/${employerId}/integrations/${res.id}`).set(boss.auth).expect(204);
      expect(await ctx.app.get(EmployersService).keyFor(res.id)).toBeNull();
      await ctx.http().delete(`/v1/employers/${employerId}/integrations/${res.id}`).set(boss.auth).expect(404);
    });
  });

  // ------------------------------------------------------------------ data requests

  describe('data requests', () => {
    it('exports everything as a file and emails a link', async () => {
      const req = (await ctx.http().post('/v1/me/data-requests').set(member.auth).send({ type: 'export' }).expect(201)).body;
      const out = await worker.get(DataRequestsService).processDue();
      expect(out.export).toBeGreaterThanOrEqual(1);
      const row = (await q(`SELECT status, result_key FROM data_requests WHERE id = $1`, [req.id]))[0];
      expect(row.status).toBe('done');
      const file = JSON.parse((await worker.get(StorageService).get(row.result_key)).toString());
      expect(file.account).toMatchObject({ id: member.userId, email: member.email });
      expect(file.linked_sites.map((s: any) => s.site)).toContain('Remote Hustle');
      expect(file.support_tickets.length).toBeGreaterThanOrEqual(1);
      expect(worker.get(MailService).outbox.filter((m) => m.to === member.email).at(-1)!.subject).toBe('Your i-jobs data is ready');
      const listed = (await ctx.http().get('/v1/me/data-requests').set(member.auth).expect(200)).body.find((r: any) => r.id === req.id);
      expect(listed.download_url).toMatch(/^https:\/\//);
    });

    it('hands corrections to a person', async () => {
      const req = (await ctx.http().post('/v1/me/data-requests').set(member.auth).send({ type: 'correct', details: 'My date of birth is wrong' }).expect(201)).body;
      await worker.get(DataRequestsService).processDue();
      expect((await q(`SELECT status FROM data_requests WHERE id = $1`, [req.id]))[0].status).toBe('in_progress');
      expect((await q(`SELECT t.category FROM support_tickets t JOIN support_messages m ON m.ticket_id = t.id WHERE m.body LIKE $1`, [`%${req.id}%`]))[0].category).toBe('data_request');
      await ctx.http().post(`/v1/admin/data-requests/${req.id}`).set(member.auth).send({ status: 'done' }).expect(403);
      expect((await ctx.http().post(`/v1/admin/data-requests/${req.id}`).set(staff.auth).send({ status: 'done', note: 'Fixed DOB' }).expect(200)).body.status).toBe('done');
    });

    it('deletes after 48 hours: the person is anonymised, payments stay, signed-in devices stop working', async () => {
      const leaver = await signIn(ctx);
      await ctx.http().patch('/v1/me/profile').set(leaver.auth).send({ headline: 'Leaving soon', skills: ['excel'] }).expect(200);
      const cvKey = `cv/${leaver.userId}/cv.pdf`;
      await worker.get(StorageService).put(cvKey, Buffer.from('%PDF-1.4 test'), 'application/pdf');
      await q(`UPDATE profiles SET cv_file_key = $2 WHERE user_id = $1`, [leaver.userId, cvKey]);
      const membership = (await q(`INSERT INTO memberships (user_id, community_id, status, source, current_period_start, current_period_end) VALUES ($1, $2, 'active', 'invite_code', now(), now() + interval '20 days') RETURNING id`, [leaver.userId, communityId]))[0].id;
      await q(`INSERT INTO payments (user_id, purpose, amount_kobo, status, membership_id, community_id, paid_at) VALUES ($1, 'membership', 500000, 'succeeded', $2, $3, now())`, [leaver.userId, membership, communityId]);

      const req = (await ctx.http().post('/v1/me/data-requests').set(leaver.auth).send({ type: 'delete' }).expect(201)).body;
      expect(ctx.mail.outbox.at(-1)).toMatchObject({ to: leaver.email, subject: 'Your i-jobs account will be deleted in 48 hours' });
      await worker.get(DataRequestsService).processDue();
      expect((await q(`SELECT status FROM data_requests WHERE id = $1`, [req.id]))[0].status).toBe('received'); // still waiting

      await q(`UPDATE data_requests SET process_after = now() - interval '1 minute' WHERE id = $1`, [req.id]);
      await worker.get(DataRequestsService).processDue();
      const u = (await q(`SELECT email, phone, full_name, status, deleted_at IS NOT NULL AS gone FROM users WHERE id = $1`, [leaver.userId]))[0];
      expect(u).toEqual({ email: `deleted-${leaver.userId}@deleted.invalid`, phone: null, full_name: null, status: 'deleted', gone: true });
      expect((await q(`SELECT count(*)::int AS n FROM profiles WHERE user_id = $1`, [leaver.userId]))[0].n).toBe(0);
      expect((await q(`SELECT count(*)::int AS n FROM payments WHERE user_id = $1`, [leaver.userId]))[0].n).toBe(1);
      expect((await q(`SELECT status FROM memberships WHERE user_id = $1`, [leaver.userId]))[0].status).toBe('cancelled');
      expect(await worker.get(StorageService).stat(cvKey)).toBeNull();
      expect((await q(`SELECT status FROM data_requests WHERE id = $1`, [req.id]))[0].status).toBe('done');
      await ctx.http().get('/v1/me').set(leaver.auth).expect(401);
      expect(worker.get(MailService).outbox.at(-1)).toMatchObject({ to: leaver.email, subject: 'Your i-jobs account has been deleted' });
    });

    it('owners are deleted by a person, after a handover', async () => {
      const owner = await signIn(ctx);
      await q(`INSERT INTO owner_profiles (user_id, legal_name, id_type, id_number_hash) VALUES ($1, 'Owner Person', 'nin', $2)`, [owner.userId, `h-${randomUUID()}`]);
      const req = (await ctx.http().post('/v1/me/data-requests').set(owner.auth).send({ type: 'delete' }).expect(201)).body;
      await q(`UPDATE data_requests SET process_after = now() WHERE id = $1`, [req.id]);
      await worker.get(DataRequestsService).processDue();
      expect((await q(`SELECT status FROM data_requests WHERE id = $1`, [req.id]))[0].status).toBe('in_progress');
      expect((await q(`SELECT status FROM users WHERE id = $1`, [owner.userId]))[0].status).toBe('active');
    });
  });
});

import { Db } from '../src/db/db.service';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { SITE_KEYS } from './env';
import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';

describe('Account, consents and partner sites', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => flushRateLimits(ctx));

  it('health check reports the database and Redis', async () => {
    const res = await ctx.http().get('/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: true, redis: true } });
  });

  it('updates name and date of birth, and locks job features for under 13s', async () => {
    const s = await signIn(ctx);
    const res = await ctx.http().patch('/v1/me').set(s.auth).send({ full_name: 'Ada Okafor', date_of_birth: '1998-04-02' }).expect(200);
    expect(res.body).toMatchObject({ full_name: 'Ada Okafor', age_band: 'adult', features_locked: false });

    const kid = await signIn(ctx);
    const year = new Date().getUTCFullYear() - 10;
    const k = await ctx.http().patch('/v1/me').set(kid.auth).send({ date_of_birth: `${year}-01-01` }).expect(200);
    expect(k.body).toMatchObject({ age_band: 'under_13', features_locked: true });

    const future = await ctx.http().patch('/v1/me').set(s.auth).send({ date_of_birth: '2999-01-01' }).expect(400);
    expect(future.body.errors[0].field).toBe('date_of_birth');
    await ctx.http().patch('/v1/me').set(s.auth).send({ role: 'admin' }).expect(400);
  });

  it('a phone number can only be on one account', async () => {
    const a = await signIn(ctx);
    const b = await signIn(ctx);
    const phone = `+234802${String(Date.now()).slice(-7)}`;
    await ctx.http().patch('/v1/me').set(a.auth).send({ phone }).expect(200);
    const res = await ctx.http().patch('/v1/me').set(b.auth).send({ phone }).expect(409);
    expect(res.body.code).toBe('phone_in_use');
  });

  it('teens need a parent to approve, by emailed link', async () => {
    const teen = await signIn(ctx);
    const year = new Date().getUTCFullYear() - 15;
    await ctx.http().patch('/v1/me').set(teen.auth).send({ full_name: 'Tobi Ade', date_of_birth: `${year}-06-01` }).expect(200);
    await ctx.http().post('/v1/me/guardian').set(teen.auth).send({ guardian_name: 'Mrs Ade', guardian_email: 'parent@example.com' }).expect(202);

    const mail = ctx.mail.outbox.at(-1)!;
    expect(mail.to).toBe('parent@example.com');
    expect(mail.subject).toBe('Tobi asked for your approval on i-jobs');
    const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)![1]);

    await ctx.http().post('/v1/guardian/decision').send({ token, decision: 'approve' }).expect(200);
    await ctx.http().post('/v1/guardian/decision').send({ token, decision: 'approve' }).expect(404);

    // i-jobs itself doesn't allow under-18s, even with approval.
    const me = await ctx.http().get('/v1/me').set(teen.auth).expect(200);
    expect(me.body.features_locked).toBe(true);
    const consents = await ctx.http().get('/v1/me/consents').set(teen.auth).expect(200);
    expect(consents.body).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'guardian', granted: true })]));

    // School1 allows under-18s with a parent's approval.
    await ctx.admin.query(
      `INSERT INTO site_accounts (site_id, user_id, external_user_id) SELECT id, $1, 'school1-tobi' FROM sites WHERE slug = 'school1'`,
      [teen.userId],
    );
    const viaSchool = await ctx.http().get('/v1/me').set('X-Site-Key', SITE_KEYS.school1).set('X-Site-User', 'school1-tobi').expect(200);
    expect(viaSchool.body.features_locked).toBe(false);
  });

  it('withdrawing autopilot consent switches autopilot off', async () => {
    const s = await signIn(ctx);
    const grant = await ctx.http().post('/v1/me/consents').set(s.auth).send({ purpose: 'autopilot', granted: true, policy_version: '2026-11' }).expect(201);
    expect(grant.body).toMatchObject({ purpose: 'autopilot', granted: true });
    const consentId = (await ctx.admin.query(`SELECT id FROM consents WHERE user_id = $1 AND purpose = 'autopilot'`, [s.userId])).rows[0].id;
    await ctx.admin.query(`INSERT INTO autopilot_rules (user_id, enabled, consent_id) VALUES ($1, true, $2)`, [s.userId, consentId]);

    await ctx.http().post('/v1/me/consents').set(s.auth).send({ purpose: 'autopilot', granted: false, policy_version: '2026-11' }).expect(201);
    const rules = await ctx.admin.query(`SELECT enabled FROM autopilot_rules WHERE user_id = $1`, [s.userId]);
    expect(rules.rows[0].enabled).toBe(false);
    const list = await ctx.http().get('/v1/me/consents').set(s.auth).expect(200);
    expect(list.body.find((c: { purpose: string }) => c.purpose === 'autopilot').granted).toBe(false);

    const bad = await ctx.http().post('/v1/me/consents').set(s.auth).send({ purpose: 'guardian', granted: true, policy_version: 'x' }).expect(400);
    expect(bad.body.errors[0].field).toBe('purpose');
  });

  it('records data requests and refuses a duplicate while one is open', async () => {
    const s = await signIn(ctx);
    const res = await ctx.http().post('/v1/me/data-requests').set(s.auth).send({ type: 'export' }).expect(201);
    expect(res.body).toMatchObject({ type: 'export', status: 'received' });
    expect(new Date(res.body.due_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
    expect((await ctx.http().post('/v1/me/data-requests').set(s.auth).send({ type: 'export' }).expect(409)).body.code).toBe('request_already_open');
    expect((await ctx.http().get('/v1/me/data-requests').set(s.auth).expect(200)).body).toHaveLength(1);
  });

  it('partner sites act for their own linked users only', async () => {
    const s = await signIn(ctx);
    const key = SITE_KEYS['remote-hustle'];

    expect((await ctx.http().get('/v1/me').set('X-Site-Key', 'sk_wrong').expect(401)).body.code).toBe('site_key_invalid');
    expect((await ctx.http().get('/v1/me').set('X-Site-Key', key).expect(400)).body.code).toBe('site_user_required');
    expect((await ctx.http().get('/v1/me').set('X-Site-Key', key).set('X-Site-User', 'rh-42').expect(404)).body.code).toBe('site_user_not_linked');

    await ctx.admin.query(
      `INSERT INTO site_accounts (site_id, user_id, external_user_id) SELECT id, $1, 'rh-42' FROM sites WHERE slug = 'remote-hustle'`,
      [s.userId],
    );
    const me = await ctx.http().get('/v1/me').set('X-Site-Key', key).set('X-Site-User', 'rh-42').expect(200);
    expect(me.body.id).toBe(s.userId);

    // School1's key cannot use Remote Hustle's user ids.
    await ctx.http().get('/v1/me').set('X-Site-Key', SITE_KEYS.school1).set('X-Site-User', 'rh-42').expect(404);
  });

  it('row-level security hides other sites rows from the app role', async () => {
    const db = ctx.app.get(Db);
    const sites = (await ctx.admin.query(`SELECT slug, id FROM sites`)).rows as { slug: string; id: string }[];
    const school1 = sites.find((x) => x.slug === 'school1')!.id;
    const rh = sites.find((x) => x.slug === 'remote-hustle')!.id;

    const seenBySchool = await db.forSite(school1, (trx) => trx.selectFrom('site_accounts').select('site_id').execute());
    expect(seenBySchool.every((r) => r.site_id === school1)).toBe(true);
    const seenByRh = await db.forSite(rh, (trx) => trx.selectFrom('site_accounts').select('site_id').execute());
    expect(seenByRh.length).toBeGreaterThan(0);
    expect(seenByRh.every((r) => r.site_id === rh)).toBe(true);
    // Without a site, the app role sees nothing in site-scoped tables.
    expect(await db.k.selectFrom('site_accounts').select('id').execute()).toHaveLength(0);
    // Workers see everything.
    const all = await db.asEngine((trx) => trx.selectFrom('site_accounts').select('site_id').execute());
    expect(new Set(all.map((r) => r.site_id)).size).toBeGreaterThanOrEqual(2);
  });

  it('hourly maintenance runs', async () => {
    const result = await new MaintenanceService(ctx.app.get(Db)).hourly();
    expect(result).toEqual(expect.objectContaining({ idempotency_keys: expect.any(Number), sessions: expect.any(Number) }));
  });
});

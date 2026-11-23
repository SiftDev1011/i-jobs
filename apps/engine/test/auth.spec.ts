import { RedisService } from '../src/redis/redis.service';
import { flushRateLimits, lastCode, signIn, startApp, TestCtx, uniqueEmail } from './helpers';

describe('Sign-in', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => flushRateLimits(ctx));

  it('creates the account on first sign-in and returns tokens', async () => {
    const email = uniqueEmail('ada');
    await ctx.http().post('/v1/auth/codes').send({ target: email.toUpperCase() }).expect(204);
    const mail = ctx.mail.outbox.at(-1)!;
    expect(mail.to).toBe(email);
    expect(mail.subject).toMatch(/is your i-jobs code$/);

    const res = await ctx.http().post('/v1/auth/sessions').send({ target: email, code: lastCode(mail.text) }).expect(200);
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.refresh_token).toEqual(expect.any(String));
    expect(res.body.expires_in).toBe(900);
    expect(res.body.user).toMatchObject({ email, age_band: 'unknown', features_locked: false, is_owner: false });

    const me = await ctx.http().get('/v1/me').set('Authorization', `Bearer ${res.body.access_token}`).expect(200);
    expect(me.body.id).toBe(res.body.user.id);
  });

  it('signs in by phone with an SMS code', async () => {
    const phone = `+234801${String(Date.now()).slice(-7)}`;
    await ctx.http().post('/v1/auth/codes').send({ target: phone.replace('+234', '+234 ') }).expect(204);
    const sms = ctx.sms.outbox.at(-1)!;
    expect(sms.to).toBe(phone);
    const res = await ctx.http().post('/v1/auth/sessions').send({ target: phone, code: lastCode(sms.text) }).expect(200);
    expect(res.body.user.phone).toBe(phone);
  });

  it('refuses a wrong code, then locks after five wrong tries', async () => {
    const email = uniqueEmail();
    await ctx.http().post('/v1/auth/codes').send({ target: email }).expect(204);
    const real = lastCode(ctx.mail.outbox.at(-1)!.text);
    const wrong = real === '000000' ? '111111' : '000000';

    const bad = await ctx.http().post('/v1/auth/sessions').send({ target: email, code: wrong }).expect(401);
    expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(bad.body).toMatchObject({ status: 401, code: 'code_invalid' });

    for (let i = 0; i < 4; i++) await ctx.http().post('/v1/auth/sessions').send({ target: email, code: wrong }).expect(401);
    const locked = await ctx.http().post('/v1/auth/sessions').send({ target: email, code: real }).expect(401);
    expect(locked.body.code).toBe('code_locked');
  });

  it('a code works only once', async () => {
    const email = uniqueEmail();
    await ctx.http().post('/v1/auth/codes').send({ target: email }).expect(204);
    const code = lastCode(ctx.mail.outbox.at(-1)!.text);
    await ctx.http().post('/v1/auth/sessions').send({ target: email, code }).expect(200);
    const again = await ctx.http().post('/v1/auth/sessions').send({ target: email, code }).expect(401);
    expect(again.body.code).toBe('code_expired');
  });

  it('limits how many codes one address can request', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) await ctx.http().post('/v1/auth/codes').send({ target: email }).expect(204);
    const res = await ctx.http().post('/v1/auth/codes').send({ target: email }).expect(429);
    expect(res.body.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('explains invalid input field by field', async () => {
    const res = await ctx.http().post('/v1/auth/sessions').send({ target: 'ada@example.com', code: '12' }).expect(400);
    expect(res.body).toMatchObject({ code: 'invalid_request', errors: [{ field: 'code', message: 'Enter the 6-digit code' }] });
    const phone = await ctx.http().post('/v1/auth/codes').send({ target: '08012345678' }).expect(400);
    expect(phone.body.errors[0].field).toBe('target');
  });

  it('rotates refresh tokens and ends the session if an old one is reused', async () => {
    const s = await signIn(ctx);
    const r1 = await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(200);
    expect(r1.body.refresh_token).not.toBe(s.refresh);

    // Within a few seconds (two tabs refreshing at once) the old token gets the same new tokens.
    const twin = await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(200);
    expect(twin.body.refresh_token).toBe(r1.body.refresh_token);

    // After that, reusing the first token means it was copied: the whole session ends.
    const redis = ctx.app.get(RedisService).client;
    await redis.del(...(await redis.keys('refresh-grace:*')));
    const reuse = await ctx.http().post('/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
    expect(reuse.body.code).toBe('session_ended');
    await ctx.http().post('/v1/auth/refresh').send({ refresh_token: r1.body.refresh_token }).expect(401);
    const me = await ctx.http().get('/v1/me').set('Authorization', `Bearer ${r1.body.access_token}`).expect(401);
    expect(me.body.code).toBe('session_ended');
  });

  it('signing out ends the session at once', async () => {
    const s = await signIn(ctx);
    await ctx.http().delete('/v1/auth/sessions/current').set(s.auth).expect(204);
    const me = await ctx.http().get('/v1/me').set(s.auth).expect(401);
    expect(me.body.code).toBe('session_ended');
  });

  it('rejects missing and forged tokens', async () => {
    expect((await ctx.http().get('/v1/me').expect(401)).body.code).toBe('unauthorized');
    expect((await ctx.http().get('/v1/me').set('Authorization', 'Bearer abc.def.ghi').expect(401)).body.code).toBe('token_invalid');
  });

  it('answers unknown routes and bad JSON as problems', async () => {
    expect((await ctx.http().get('/v1/nope').expect(404)).body.code).toBe('route_not_found');
    const bad = await ctx.http().post('/v1/auth/codes').set('Content-Type', 'application/json').send('{"target":').expect(400);
    expect(bad.body.code).toBe('invalid_json');
  });
});

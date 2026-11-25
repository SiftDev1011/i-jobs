import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';

const TAG = `eo${Date.now().toString(36)}`;

/** SMS_DRIVER=none: i-jobs runs email-only. No phone sign-in, no phone invites, no free weeks. */
describe('Running without texts (SMS_DRIVER=none)', () => {
  let ctx: TestCtx;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let admin: Awaited<ReturnType<typeof signIn>>;
  let community: { id: string; invite_code: string; slug: string };
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;
  const before = process.env.SMS_DRIVER;

  beforeAll(async () => {
    process.env.SMS_DRIVER = 'none';
    ctx = await startApp();
    owner = await signIn(ctx);
    admin = await signIn(ctx);
    await q(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'admin')`, [admin.userId]);
  });
  afterAll(async () => {
    await ctx.close();
    process.env.SMS_DRIVER = before;
  });
  beforeEach(() => flushRateLimits(ctx));

  it('says what is off, so apps can hide it', async () => {
    expect((await ctx.http().get('/v1/features').expect(200)).body).toEqual({ phone_sign_in: false, phone_invites: false, free_weeks: false, demo_payments: true, payments: true });
  });

  it('refuses phone sign-in; email still works', async () => {
    const r = await ctx.http().post('/v1/auth/codes').send({ target: '+2348031234567' }).expect(422);
    expect(r.body.code).toBe('phone_sign_in_off');
    await ctx.http().post('/v1/auth/codes').send({ target: `someone.${TAG}@example.com` }).expect(204);
    expect(ctx.sms.outbox).toHaveLength(0);
  });

  it('never turns on free weeks for a community, even if asked', async () => {
    const res = await ctx.http().post('/v1/owner/applications').set(owner.auth).send({
      legal_name: 'Ngozi Obi', id_type: 'nin', id_number: `NIN${TAG}`, community_name: 'Email Only Crew', slug: `email-only-${TAG}`,
      proof_links: ['https://t.me/emailonly'], price: { amount_minor: 600000, currency: 'NGN' }, billing_period: 'monthly', trial_enabled: true,
    }).expect(201);
    community = res.body;
    expect(res.body.trial_enabled).toBe(false);
    await ctx.http().post(`/v1/admin/communities/${community.id}/verify`).set(admin.auth).send({ decision: 'approved' }).expect(200);
    const patched = await ctx.http().patch(`/v1/owner/communities/${community.id}`).set(owner.auth).send({ trial_enabled: true }).expect(200);
    expect(patched.body.trial_enabled).toBe(false);
    expect((await q(`SELECT trial_enabled FROM communities WHERE id = $1`, [community.id]))[0].trial_enabled).toBe(false);
  });

  it('a community set up with free weeks before texts were turned off offers none', async () => {
    await q(`UPDATE communities SET trial_enabled = true WHERE id = $1`, [community.id]);
    expect((await ctx.http().get(`/v1/join/${community.invite_code}`).expect(200)).body.trial_available).toBe(false);
    const member = await signIn(ctx);
    const m = (await ctx.http().post('/v1/join').set(member.auth).send({ code: community.invite_code }).expect(201)).body;
    const r = await ctx.http().post(`/v1/memberships/${m.id}/trial`).set(member.auth).send({ phone_verification_code: '123456' }).expect(409);
    expect(r.body.code).toBe('trials_off');
  });

  it('invites go by email only; phone numbers are reported back', async () => {
    const r = await ctx.http().post(`/v1/owner/communities/${community.id}/invites`).set(owner.auth)
      .send({ targets: [`friend.${TAG}@example.com`, '+2348035550000'] }).expect(202);
    expect(r.body).toEqual({ queued: 1, skipped_duplicates: 0, invalid: ['+2348035550000'] });
  });
});

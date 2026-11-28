import { createHash } from 'node:crypto';
import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';

const TAG = `pr${Date.now().toString(36)}`;
const BASE = 'https://paga.test';
const HASH_KEY = 'test-hash-key';

/** The real Paga driver, with Paga itself stood in for: what we send, and what happens when Paga says no. */
describe('Paga payment requests (PAGA_DRIVER=paga)', () => {
  let ctx: TestCtx;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let community: { id: string };
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;
  const saved = { ...process.env };
  const realFetch = global.fetch;
  let pagaAnswer: { status: number; body: unknown };
  let sent: { url: string; headers: Record<string, string>; body: any }[] = [];

  beforeAll(async () => {
    Object.assign(process.env, { PAGA_DRIVER: 'paga', PAGA_BASE_URL: BASE, PAGA_PUBLIC_KEY: 'pub', PAGA_SECRET_KEY: 'sec', PAGA_HASH_KEY: HASH_KEY });
    global.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      if (!url.startsWith(BASE)) return realFetch(input, init);
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(pagaAnswer.body), { status: pagaAnswer.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    ctx = await startApp();
    owner = await signIn(ctx);
    const admin = await signIn(ctx);
    await q(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'admin')`, [admin.userId]);
    community = (await ctx.http().post('/v1/owner/applications').set(owner.auth).send({
      legal_name: 'Ada Obi', id_type: 'nin', id_number: `NIN${TAG}`, community_name: 'Paga Test Crew', slug: `paga-test-${TAG}`,
      proof_links: ['https://t.me/pagatest'], price: { amount_minor: 600000, currency: 'NGN' }, billing_period: 'monthly',
    }).expect(201)).body;
    await ctx.http().post(`/v1/admin/communities/${community.id}/verify`).set(admin.auth).send({ decision: 'approved' }).expect(200);
  });
  afterAll(async () => {
    await ctx.close();
    global.fetch = realFetch;
    process.env = saved;
  });
  beforeEach(async () => {
    sent = [];
    await flushRateLimits(ctx);
  });

  it('sends the amount as a number of naira, signed the way Paga checks it, and returns Paga\'s pay page', async () => {
    pagaAnswer = { status: 200, body: { statusCode: '0', referenceNumber: 'x', paymentMethods: [{ name: 'REQUEST_MONEY', properties: { WebPaymentLink: 'https://beta.justpaga.me/pay/abc' } }] } };
    const r = await ctx.http().post(`/v1/owner/communities/${community.id}/code-batches`).set(owner.auth).set('Idempotency-Key', `k-${TAG}-1`)
      .send({ quantity: 5, accept_terms: true }).expect(201);
    expect(r.body.checkout.checkout_url).toBe('https://beta.justpaga.me/pay/abc');

    expect(sent).toHaveLength(1);
    const { url, headers, body } = sent[0];
    expect(url).toBe(`${BASE}/paymentRequest`);
    expect(body.amount).toBe(9000); // 5 codes × 30% of ₦6,000, a JSON number, not "9000.00"
    expect(typeof body.amount).toBe('number');
    expect(body.currency).toBe('NGN');
    expect(body.expiryDateTimeUTC).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    expect(body.callBackUrl).toMatch(/\/v1\/hooks\/paga$/);
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('pub:sec').toString('base64')}`);
    const expected = createHash('sha512').update(`${body.referenceNumber}9000NGN${body.payer.phoneNumber ?? ''}${body.payer.email ?? ''}${HASH_KEY}`).digest('hex');
    expect(headers.hash).toBe(expected);
  });

  it('when Paga says no, owners get a clear "try again" and no unpaid batch is left behind', async () => {
    pagaAnswer = { status: 500, body: { statusCode: -1, statusMessage: 'system error' } };
    const before = await q(`SELECT count(*)::int AS n FROM code_batches WHERE community_id = $1`, [community.id]);
    const r = await ctx.http().post(`/v1/owner/communities/${community.id}/code-batches`).set(owner.auth).set('Idempotency-Key', `k-${TAG}-2`)
      .send({ quantity: 5, accept_terms: true }).expect(503);
    expect(r.body).toMatchObject({ code: 'payment_provider_error', title: expect.stringMatching(/Paga/) });
    expect(await q(`SELECT count(*)::int AS n FROM code_batches WHERE community_id = $1`, [community.id])).toEqual(before);
    expect(await q(`SELECT id FROM payments WHERE community_id = $1 AND status = 'pending' AND checkout_url IS NULL`, [community.id])).toEqual([]);
  });

  it('a member\'s checkout that Paga refuses is marked failed, not left pending', async () => {
    pagaAnswer = { status: 200, body: { statusCode: '0', paymentMethods: [] } }; // accepted, but no pay page
    const member = await signIn(ctx);
    const invite = (await q(`SELECT invite_code FROM communities WHERE id = $1`, [community.id]))[0].invite_code;
    const m = (await ctx.http().post('/v1/join').set(member.auth).send({ code: invite }).expect(201)).body;
    const r = await ctx.http().post(`/v1/memberships/${m.id}/checkout`).set(member.auth).set('Idempotency-Key', `k-${TAG}-3`).expect(503);
    expect(r.body.code).toBe('payment_provider_error');
    expect(await q(`SELECT status FROM payments WHERE membership_id = $1`, [m.id])).toEqual([{ status: 'failed' }]);
  });
});

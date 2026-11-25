import { PagaClient } from '../src/money/paga';
import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';

const TAG = `po${Date.now().toString(36)}`;

/** PAGA_DRIVER=off: payments aren't set up yet. Everything else runs; checkouts say "payments open soon". */
describe('Payments not set up yet (PAGA_DRIVER=off)', () => {
  let ctx: TestCtx;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let member: Awaited<ReturnType<typeof signIn>>;
  let community: { id: string; invite_code: string };
  let membershipId: string;
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;
  const before = process.env.PAGA_DRIVER;

  beforeAll(async () => {
    process.env.PAGA_DRIVER = 'off';
    ctx = await startApp();
    owner = await signIn(ctx);
    member = await signIn(ctx);
    const admin = await signIn(ctx);
    await q(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'admin')`, [admin.userId]);
    community = (await ctx.http().post('/v1/owner/applications').set(owner.auth).send({
      legal_name: 'Kemi Ade', id_type: 'nin', id_number: `NIN${TAG}`, community_name: 'Soon Paying Crew', slug: `soon-paying-${TAG}`,
      proof_links: ['https://t.me/soonpaying'], price: { amount_minor: 600000, currency: 'NGN' }, billing_period: 'monthly',
    }).expect(201)).body;
    await ctx.http().post(`/v1/admin/communities/${community.id}/verify`).set(admin.auth).send({ decision: 'approved' }).expect(200);
  });
  afterAll(async () => {
    await ctx.close();
    process.env.PAGA_DRIVER = before;
  });
  beforeEach(() => flushRateLimits(ctx));

  it('says payments are off, so apps can say "payments open soon"', async () => {
    expect((await ctx.http().get('/v1/features').expect(200)).body).toMatchObject({ payments: false, demo_payments: false });
  });

  it('people can still join; paying is refused and leaves nothing half made', async () => {
    membershipId = (await ctx.http().post('/v1/join').set(member.auth).send({ code: community.invite_code }).expect(201)).body.id;
    const r = await ctx.http().post(`/v1/memberships/${membershipId}/checkout`).set(member.auth).set('Idempotency-Key', `k-${TAG}-1`).expect(503);
    expect(r.body).toMatchObject({ code: 'payments_off', title: expect.stringMatching(/open soon/) });
    expect(await q(`SELECT id FROM payments WHERE membership_id = $1`, [membershipId])).toEqual([]);
  });

  it('owners can\'t buy Selar codes yet, and no batch is created', async () => {
    const r = await ctx.http().post(`/v1/owner/communities/${community.id}/code-batches`).set(owner.auth).set('Idempotency-Key', `k-${TAG}-2`)
      .send({ quantity: 5, accept_terms: true }).expect(503);
    expect(r.body.code).toBe('payments_off');
    expect(await q(`SELECT id FROM code_batches WHERE community_id = $1`, [community.id])).toEqual([]);
  });

  it('refuses any Paga callback, even a correctly signed one', async () => {
    const paga = ctx.app.get(PagaClient);
    const cb = paga.signCallback({ notificationId: `n-${TAG}`, statusCode: '0', externalReferenceNumber: `ref-${TAG}`, state: 'COMPLETE', event: 'PAYMENT_COMPLETE', outstandingBalance: null, paymentAmount: 6000, collectionFee: 0 });
    await ctx.http().post('/v1/hooks/paga').send(cb).expect(401);
  });

  it('demo payments are off too', async () => {
    await ctx.http().post(`/v1/dev/demo-payments/00000000-0000-4000-8000-000000000000/complete`).set(member.auth).expect(404);
  });
});

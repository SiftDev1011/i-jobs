import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AiService } from '../src/ai/ai.service';
import { MembershipService } from '../src/communities/membership.service';
import { OwnerService } from '../src/communities/owner.service';
import { PipelineService } from '../src/ingest/pipeline.service';
import { PagaClient } from '../src/money/paga';
import { PayoutsService } from '../src/money/payouts.service';
import { WorkerModule } from '../src/worker.module';
import { flushRateLimits, lastCode, signIn, startApp, TestCtx, uniqueEmail } from './helpers';

const TAG = Date.now().toString(36);

describe('Communities and money', () => {
  let ctx: TestCtx;
  let worker: INestApplicationContext;
  let paga: PagaClient;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let admin: Awaited<ReturnType<typeof signIn>>;
  let community: { id: string; invite_code: string; slug: string };
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;
  const idem = () => ({ 'Idempotency-Key': `k-${Math.random()}` });
  const pay = async (paymentId: string, amountNaira: number, status = 200) => {
    const ref = (await q(`SELECT provider_ref FROM payments WHERE id = $1`, [paymentId]))[0].provider_ref;
    const cb = paga.signCallback({ notificationId: `n-${paymentId}`, statusCode: '0', externalReferenceNumber: ref, state: 'COMPLETE', event: 'PAYMENT_COMPLETE', outstandingBalance: null, paymentAmount: amountNaira, collectionFee: 0 });
    return ctx.http().post('/v1/hooks/paga').send(cb).expect(status);
  };
  const application = (over: Record<string, unknown> = {}) => ({
    legal_name: 'Tunde Bakare', id_type: 'nin', id_number: `NIN${TAG}`, bank_code: '058', bank_account_number: '0123456789',
    community_name: 'Lagos Tech Hub', slug: `lagos-tech-${TAG}`, proof_links: ['https://chat.whatsapp.com/abc'], claimed_member_count: 400,
    price: { amount_minor: 1_000_000, currency: 'NGN' }, billing_period: 'monthly', trial_enabled: true, ...over,
  });

  beforeAll(async () => {
    ctx = await startApp();
    paga = ctx.app.get(PagaClient);
    worker = await (await Test.createTestingModule({ imports: [WorkerModule] }).compile()).init();
    owner = await signIn(ctx);
    admin = await signIn(ctx);
    await q(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'admin')`, [admin.userId]);
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });
  beforeEach(() => flushRateLimits(ctx));

  it('owner pricing rules show the floor and our share (owner page only)', async () => {
    expect((await ctx.http().get('/v1/owner/pricing-rules').set(owner.auth).expect(200)).body).toEqual({
      minimum_price: { amount_minor: 500000, currency: 'NGN' }, platform_share_percent: 30,
      code_unit_share: { amount_minor: 150000, currency: 'NGN' }, billing_periods: ['monthly', 'quarterly', 'yearly'],
    });
  });

  it('an owner applies; one identity per person; nothing is public until approved', async () => {
    expect((await ctx.http().post('/v1/owner/applications').set(owner.auth).send(application({ price: { amount_minor: 400000, currency: 'NGN' } })).expect(422)).body.code).toBe('price_below_minimum');
    const res = await ctx.http().post('/v1/owner/applications').set(owner.auth).send(application()).expect(201);
    expect(res.body).toMatchObject({ status: 'pending_review', invite_code: expect.stringMatching(/^LTH-\d{4}$/), platform_share_percent: 30, demo_tours_left: 2, verification: 'pending' });
    community = res.body;

    const other = await signIn(ctx);
    expect((await ctx.http().post('/v1/owner/applications').set(other.auth).send(application({ slug: `other-${TAG}` })).expect(409)).body.code).toBe('owner_identity_exists');
    expect((await ctx.http().post('/v1/owner/applications').set(other.auth).send(application({ id_number: `X${TAG}`, bank_account_number: '9999999999' })).expect(409)).body.code).toBe('slug_taken');
    await ctx.http().get(`/v1/join/${community.slug}`).expect(404);
  });

  it('our team approves it, which verifies the owner too', async () => {
    const member = await signIn(ctx);
    await ctx.http().post(`/v1/admin/communities/${community.id}/verify`).set(member.auth).send({ decision: 'approved' }).expect(403);
    await ctx.http().post(`/v1/admin/communities/${community.id}/verify`).set(admin.auth).send({ decision: 'approved' }).expect(200);
    expect((await ctx.http().get(`/v1/owner/communities/${community.id}`).set(owner.auth).expect(200)).body).toMatchObject({ status: 'active', verification: 'approved' });
    expect((await q(`SELECT payout_eligible, identity_verified_at IS NOT NULL AS verified FROM owner_profiles WHERE user_id = $1`, [owner.userId]))[0]).toEqual({ payout_eligible: true, verified: true });
    expect(ctx.mail.outbox.at(-1)!.subject).toBe('Your community on i-jobs: Lagos Tech Hub');
  });

  let m1: Awaited<ReturnType<typeof signIn>>;
  let m1Membership: string;

  it('members find it (no prices), see the price on the join page, and join', async () => {
    const found = (await ctx.http().get('/v1/communities?q=Lagos Tech').expect(200)).body.items.find((c: any) => c.id === community.id);
    expect(found).toEqual({ id: community.id, name: 'Lagos Tech Hub', slug: community.slug, member_count: 0, verified: true });
    const page = (await ctx.http().get(`/v1/join/${community.invite_code}`).expect(200)).body;
    expect(page).toMatchObject({ kind: 'community_invite', price: { amount_minor: 1_000_000, currency: 'NGN' }, trial_available: true, approval_required: false });

    m1 = await signIn(ctx);
    const joined = await ctx.http().post('/v1/join').set(m1.auth).send({ code: community.invite_code }).expect(201);
    expect(joined.body).toMatchObject({ status: 'pending_payment', source: 'invite_code', onboarding_step: 'joined', switch_offer: false });
    m1Membership = joined.body.id;
    expect((await ctx.http().post('/v1/join').set(m1.auth).send({ code: community.slug }).expect(409)).body.code).toBe('already_member');
    expect((await q(`SELECT referred_by_community_id FROM users WHERE id = $1`, [m1.userId]))[0].referred_by_community_id).toBe(community.id);
  });

  it('a free trial needs a real phone number, once per person', async () => {
    expect((await ctx.http().post(`/v1/memberships/${m1Membership}/trial`).set(m1.auth).send({ phone_verification_code: '123456' }).expect(422)).body.code).toBe('phone_required');
    const phone = `+234803${String(Date.now()).slice(-7)}`;
    await ctx.http().patch('/v1/me').set(m1.auth).send({ phone }).expect(200);
    await ctx.http().post('/v1/auth/codes').send({ target: phone }).expect(204);
    const code = lastCode(ctx.sms.outbox.at(-1)!.text);
    const res = await ctx.http().post(`/v1/memberships/${m1Membership}/trial`).set(m1.auth).send({ phone_verification_code: code, card_token: `card-${TAG}` }).expect(200);
    expect(res.body.status).toBe('trialing');
    expect(new Date(res.body.trial_ends_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
  });

  it('paying through Paga activates the membership and splits the money in the ledger', async () => {
    await ctx.http().post(`/v1/memberships/${m1Membership}/checkout`).set(m1.auth).expect(400); // Idempotency-Key required
    const co = await ctx.http().post(`/v1/memberships/${m1Membership}/checkout`).set(m1.auth).set(idem()).expect(201);
    expect(co.body).toMatchObject({ provider: 'paga', checkout_url: expect.stringMatching(/^\/demo-pay\//), amount: { amount_minor: 1_000_000, currency: 'NGN' } });
    expect(paga.fakeRequests.at(-1)).toMatchObject({ amountKobo: 1_000_000, callbackUrl: expect.stringMatching(/\/v1\/hooks\/paga$/) });

    const bad = paga.signCallback({ notificationId: 'x', statusCode: '0', externalReferenceNumber: co.body.reference, state: 'COMPLETE', outstandingBalance: null });
    await ctx.http().post('/v1/hooks/paga').send({ ...bad, hash: 'f'.repeat(128) }).expect(401);

    expect((await pay(co.body.payment_id, 10000)).body).toEqual({ status: 'paid' });
    expect((await pay(co.body.payment_id, 10000)).body).toEqual({ status: 'ignored' }); // twice is safe
    expect((await ctx.http().get(`/v1/payments/${co.body.payment_id}`).set(m1.auth).expect(200)).body).toMatchObject({ purpose: 'membership', status: 'succeeded', community: { name: 'Lagos Tech Hub' }, membership_id: m1Membership });
    expect((await ctx.http().get(`/v1/payments/${co.body.payment_id}`).set(owner.auth).expect(404)).body.code).toBe('payment_not_found');

    const m = (await ctx.http().get('/v1/me/memberships').set(m1.auth).expect(200)).body[0];
    expect(m).toMatchObject({ status: 'active', onboarding_step: 'paid' });
    // Paid during the trial: the 30 days start when the trial ends.
    expect(new Date(m.current_period_end).getTime() - Date.now()).toBeGreaterThan(36 * 86400_000);

    const lines = await q(`SELECT account, amount_kobo::int AS kobo FROM ledger_entries WHERE payment_id = $1 ORDER BY account::text`, [co.body.payment_id]);
    expect(lines).toEqual([{ account: 'cash', kobo: 1_000_000 }, { account: 'owner_payable', kobo: -700_000 }, { account: 'platform_revenue', kobo: -300_000 }]);
    expect(await q(`SELECT * FROM ledger_unbalanced`)).toEqual([]);
    expect((await q(`SELECT balance_kobo::int AS b FROM owner_balances WHERE community_id = $1`, [community.id]))[0].b).toBe(700_000);
  });

  it('owners see first names and progress, never contact details; nudges go through us', async () => {
    await ctx.http().patch('/v1/me').set(m1.auth).send({ full_name: 'Chidi Okeke' }).expect(200);
    const list = (await ctx.http().get(`/v1/owner/communities/${community.id}/members`).set(owner.auth).expect(200)).body.items;
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(['can_nudge', 'current_period_end', 'first_name', 'joined_at', 'membership_id', 'onboarding_step', 'status', 'trial_ends_at']);
    expect(list[0]).toMatchObject({ first_name: 'Chidi', status: 'active', can_nudge: true });

    await ctx.http().post(`/v1/owner/communities/${community.id}/members/${m1Membership}/nudge`).set(owner.auth).expect(202);
    expect(ctx.mail.outbox.at(-1)).toMatchObject({ to: m1.email, subject: 'Lagos Tech Hub: one step left' });
    await ctx.http().post(`/v1/owner/communities/${community.id}/members/${m1Membership}/nudge`).set(owner.auth).expect(429);

    const funnel = (await ctx.http().get(`/v1/owner/communities/${community.id}/funnel`).set(owner.auth).expect(200)).body;
    expect(funnel).toMatchObject({ joined: 1, paid: 1, stuck_no_cv: 1, interviews_landed: 0 });
    const stranger = await signIn(ctx);
    expect((await ctx.http().get(`/v1/owner/communities/${community.id}/funnel`).set(stranger.auth).expect(404)).body.code).toBe('community_not_found');
  });

  it('approval: requests wait for the owner; declined ones are closed', async () => {
    await ctx.http().patch(`/v1/owner/communities/${community.id}`).set(owner.auth).send({ approval_required: true }).expect(200);
    const m2 = await signIn(ctx);
    const req = (await ctx.http().post(`/v1/communities/${community.id}/join-requests`).set(m2.auth).expect(201)).body;
    expect(req).toMatchObject({ status: 'pending_approval', source: 'search' });
    expect((await ctx.http().post(`/v1/memberships/${req.id}/checkout`).set(m2.auth).set(idem()).expect(403)).body.code).toBe('awaiting_approval');
    expect((await ctx.http().post(`/v1/owner/communities/${community.id}/members/${req.id}/approve`).set(owner.auth).expect(200)).body.status).toBe('pending_payment');

    const m3 = await signIn(ctx);
    const r3 = (await ctx.http().post('/v1/join').set(m3.auth).send({ code: community.slug }).expect(201)).body;
    expect(r3.status).toBe('pending_approval');
    await ctx.http().post(`/v1/owner/communities/${community.id}/members/${r3.id}/decline`).set(owner.auth).expect(204);
    expect((await ctx.http().get('/v1/me/memberships').set(m3.auth).expect(200)).body[0].status).toBe('cancelled');
    await ctx.http().patch(`/v1/owner/communities/${community.id}`).set(owner.auth).send({ approval_required: false, price: { amount_minor: 300000, currency: 'NGN' } }).expect(422);
  });

  it('bulk invites: cleaned, de-duplicated, sent by us, masked for the owner, credited on join', async () => {
    const email = uniqueEmail('invitee');
    const res = await ctx.http().post(`/v1/owner/communities/${community.id}/invites`).set(owner.auth).send({ targets: [email, '+2348021234502', 'not-a-contact', email.toUpperCase()] }).expect(202);
    expect(res.body).toEqual({ queued: 2, skipped_duplicates: 0, invalid: ['not-a-contact'] });
    expect(await ctx.app.get(OwnerService).deliverInvites(community.id)).toEqual({ sent: 2 });
    expect(ctx.sms.outbox.at(-1)).toMatchObject({ to: '+2348021234502' });
    const list = (await ctx.http().get(`/v1/owner/communities/${community.id}/invites`).set(owner.auth).expect(200)).body.items;
    expect(list.map((i: any) => i.target_masked).sort()).toEqual(['+234 802 *** **02', expect.stringMatching(/^i\*+@example\.com$/)].sort());

    const invited = await signIn(ctx, email);
    const joined = (await ctx.http().post('/v1/join').set(invited.auth).send({ code: community.slug, via: 'invite_link' }).expect(201)).body;
    expect(joined.source).toBe('bulk_invite');
    expect((await q(`SELECT status FROM community_invites WHERE target = $1`, [email]))[0].status).toBe('joined');
  });

  it('demo tours: two per community, each link opens for a day without signing in', async () => {
    const one = (await ctx.http().post(`/v1/owner/communities/${community.id}/demo-tours`).set(owner.auth).expect(201)).body;
    expect(one).toMatchObject({ tours_left: 1, demo_url: expect.stringMatching(/\/demo\/[A-Za-z0-9_-]+$/) });
    const token = one.demo_url.split('/').pop();
    const view = (await ctx.http().get(`/v1/demo/${token}`).expect(200)).body;
    expect(view.community).toEqual({ name: 'Lagos Tech Hub', slug: community.slug });
    expect(new Date(view.expires_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect((await ctx.http().get('/v1/demo/not-a-real-token').expect(404)).body.code).toBe('demo_not_found');
    await ctx.http().post(`/v1/owner/communities/${community.id}/demo-tours`).set(owner.auth).expect(201);
    expect((await ctx.http().post(`/v1/owner/communities/${community.id}/demo-tours`).set(owner.auth).expect(409)).body.code).toBe('demo_tours_used_up');
  });

  let codes: string[];
  it('Selar codes: prepaid share, created on payment, CSV for Selar, single use', async () => {
    await ctx.http().post(`/v1/owner/communities/${community.id}/code-batches`).set(owner.auth).set(idem()).send({ quantity: 3, accept_terms: false }).expect(400);
    const buy = await ctx.http().post(`/v1/owner/communities/${community.id}/code-batches`).set(owner.auth).set(idem()).send({ quantity: 3, accept_terms: true }).expect(201);
    expect(buy.body.batch).toMatchObject({ quantity: 3, unit_share: { amount_minor: 300_000 }, total: { amount_minor: 900_000 }, paid: false, grants_period: 'monthly' });
    expect((await ctx.http().get(`/v1/owner/code-batches/${buy.body.batch.id}/codes`).set(owner.auth).expect(402)).body.code).toBe('batch_unpaid');

    await pay(buy.body.checkout.payment_id, 9000);
    const csv = await ctx.http().get(`/v1/owner/code-batches/${buy.body.batch.id}/codes`).set(owner.auth).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    codes = csv.text.trim().split('\n').slice(1).map((l) => l.split(',')[0]);
    expect(codes).toHaveLength(3);
    expect(codes[0]).toMatch(/^LTH-[A-Z2-9]{8}$/);
    expect((await q(`SELECT account, amount_kobo::int AS kobo FROM ledger_entries WHERE payment_id = $1 ORDER BY account::text`, [buy.body.checkout.payment_id]))).toEqual([{ account: 'cash', kobo: 900_000 }, { account: 'platform_revenue', kobo: -900_000 }]);

    const buyer = await signIn(ctx);
    expect((await ctx.http().get(`/v1/join/${codes[0]}`).expect(200)).body).toMatchObject({ kind: 'access_code', price: null });
    const m = (await ctx.http().post('/v1/join').set(buyer.auth).send({ code: codes[0] }).expect(201)).body;
    expect(m).toMatchObject({ status: 'active', source: 'access_code', onboarding_step: 'paid' });
    const again = await signIn(ctx);
    expect((await ctx.http().post('/v1/join').set(again.auth).send({ code: codes[0] }).expect(409)).body.code).toBe('code_used');
    expect((await ctx.http().get(`/v1/join/${codes[0]}`).expect(404)).body.code).toBe('code_used');
  });

  it('pasted jobs: AI reads them, the owner confirms, then they go live and can be renewed', async () => {
    worker.get(AiService).useChat(async () => ({
      status: 200, headers: new Headers(),
      json: { choices: [{ message: { content: JSON.stringify({ is_job: true, title: 'Junior Accountant', company: 'Ledgerly', employment_type: 'full_time', remote: false, location_text: 'Lagos, Nigeria', countries: ['NG'], apply_email: 'hr@ledgerly.example', summary: 'Entry-level accounting role in Lagos.', skills: ['excel'] }) } }], usage: { prompt_tokens: 300, completion_tokens: 150 } },
    }));
    ctx.app.get(AiService).useChat(async () => ({ status: 200, headers: new Headers(), json: {} }));
    const text = 'URGENT: Ledgerly Ltd is hiring a Junior Accountant in Lagos. 1-2 years experience, Excel skills. Send CV to hr@ledgerly.example';
    const res = await ctx.http().post(`/v1/owner/communities/${community.id}/jobs`).set(owner.auth).send({ text }).expect(202);
    expect(res.body).toMatchObject({ kind: 'job_paste', status: 'queued' });
    expect((await ctx.http().get(`/v1/owner/communities/${community.id}/jobs`).set(owner.auth).expect(200)).body.items[0].state).toBe('reading');

    expect(await worker.get(PipelineService).processOne(res.body.work_id)).toMatchObject({ result: 'created', status: 'pending_review' });
    const items = (await ctx.http().get(`/v1/owner/communities/${community.id}/jobs`).set(owner.auth).expect(200)).body.items;
    expect(items[0]).toMatchObject({ state: 'needs_confirmation', job: { title: 'Junior Accountant', company_name: 'Ledgerly', apply_email: 'hr@ledgerly.example' } });
    const jobId = items[0].job.id;
    await ctx.http().get(`/v1/jobs/${jobId}`).expect(404); // not public before the owner confirms

    const confirmed = await ctx.http().post(`/v1/owner/communities/${community.id}/jobs/${jobId}/confirm`).set(owner.auth).send({ title: 'Junior Accountant (Lagos)' }).expect(200);
    expect(confirmed.body).toMatchObject({ state: 'live', can_renew: true, job: { title: 'Junior Accountant (Lagos)' } });
    expect((await ctx.http().get(`/v1/jobs/${jobId}`).expect(200)).body).toMatchObject({ community: { name: 'Lagos Tech Hub' } });
    const renewed = await ctx.http().post(`/v1/owner/communities/${community.id}/jobs/${jobId}/renew`).set(owner.auth).expect(200);
    expect(new Date(renewed.body.expires_at).getTime() - Date.now()).toBeGreaterThan(20 * 86400_000);
  });

  it('payouts: only settled money, released and confirmed by finance, then the ledger moves', async () => {
    const payouts = ctx.app.get(PayoutsService);
    expect(await payouts.createMonthly()).toEqual({ created: 0 }); // money is less than 7 days old
    const earn = (await ctx.http().get(`/v1/owner/communities/${community.id}/earnings`).set(owner.auth).expect(200)).body;
    expect(earn).toMatchObject({ balance: { amount_minor: 700_000 }, on_hold: { amount_minor: 700_000 }, payouts: [] });

    await q(`UPDATE ledger_entries SET created_at = now() - interval '10 days' WHERE community_id = $1`, [community.id]);
    expect(await payouts.createMonthly()).toEqual({ created: 1 });
    expect(await payouts.createMonthly()).toEqual({ created: 0 }); // never twice
    const p = (await ctx.http().get('/v1/admin/payouts?status=ready').set(admin.auth).expect(200)).body.items.find((x: any) => x.community.id === community.id);
    expect(p).toMatchObject({ amount: { amount_minor: 700_000 }, payee: { legal_name: 'Tunde Bakare', account_last4: '6789', identity_verified: true } });

    await ctx.http().post(`/v1/admin/payouts/${p.id}/paid`).set(admin.auth).send({ reference: 'PAGA-123456' }).expect(409);
    expect((await ctx.http().post(`/v1/admin/payouts/${p.id}/release`).set(admin.auth).expect(202)).body.status).toBe('processing');
    await ctx.http().post(`/v1/admin/payouts/${p.id}/paid`).set(admin.auth).send({ reference: 'PAGA-123456' }).expect(200);
    expect((await q(`SELECT balance_kobo::int AS b FROM owner_balances WHERE community_id = $1`, [community.id]))[0].b).toBe(0);
    expect(await q(`SELECT * FROM ledger_unbalanced`)).toEqual([]);
    expect((await ctx.http().get(`/v1/owner/communities/${community.id}/earnings`).set(owner.auth).expect(200)).body.payouts[0]).toMatchObject({ status: 'paid', amount: { amount_minor: 700_000 } });
  });

  it('demo payments: with fake Paga, the payer completes checkout on the web app\'s demo page', async () => {
    expect((await ctx.http().get('/v1/features').expect(200)).body.demo_payments).toBe(true);
    const buy = await ctx.http().post(`/v1/owner/communities/${community.id}/code-batches`).set(owner.auth).set(idem()).send({ quantity: 1, accept_terms: true }).expect(201);
    const id = buy.body.checkout.payment_id;
    expect(buy.body.checkout.checkout_url).toBe(`/demo-pay/${id}`);
    expect((await ctx.http().post(`/v1/dev/demo-payments/${id}/complete`).set(m1.auth).expect(404)).body.code).toBe('payment_not_found');
    expect((await ctx.http().post(`/v1/dev/demo-payments/${id}/complete`).set(owner.auth).expect(200)).body).toMatchObject({ id, purpose: 'code_batch', status: 'succeeded' });
    await ctx.http().post(`/v1/dev/demo-payments/${id}/complete`).set(owner.auth).expect(200); // twice is safe
    expect(await q(`SELECT account, amount_kobo::int AS kobo FROM ledger_entries WHERE payment_id = $1 ORDER BY account::text`, [id])).toEqual([{ account: 'cash', kobo: 300_000 }, { account: 'platform_revenue', kobo: -300_000 }]);
  });

  it('a ban voids unused codes; members keep access until their period ends, then get a switch offer', async () => {
    const res = await ctx.http().post(`/v1/admin/communities/${community.id}/ban`).set(admin.auth).send({ reason: 'Selling fake job guarantees' }).expect(200);
    expect(res.body).toMatchObject({ status: 'banned', members_keeping_access: expect.any(Number) });
    expect((await q(`SELECT status FROM access_codes WHERE code = $1`, [codes[1]]))[0].status).toBe('void');
    const m = (await ctx.http().get('/v1/me/memberships').set(m1.auth).expect(200)).body[0];
    expect(m).toMatchObject({ status: 'active', switch_offer: true });
    await ctx.http().get(`/v1/join/${community.slug}`).expect(404);
    expect((await q(`SELECT banned_at IS NOT NULL AS banned FROM owner_profiles WHERE user_id = $1`, [owner.userId]))[0].banned).toBe(true);

    await q(`UPDATE memberships SET current_period_end = now() - interval '1 hour' WHERE id = $1`, [m1Membership]);
    const life = await ctx.app.get(MembershipService).lifecycle();
    expect(life.lapsed).toBeGreaterThanOrEqual(1);
    expect(life.ended).toBeGreaterThanOrEqual(1); // banned community: no grace days
    expect((await ctx.http().get('/v1/me/memberships').set(m1.auth).expect(200)).body[0]).toMatchObject({ status: 'expired', switch_offer: true });
  });

  it('fraud checks run without false alarms on normal data', async () => {
    const r = await ctx.app.get(PayoutsService).fraudChecks();
    expect(r.opened).toBe(0);
  });
});

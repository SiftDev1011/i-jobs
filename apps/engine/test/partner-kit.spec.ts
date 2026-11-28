import path from 'node:path';
import { WebhooksService, signature } from '../src/partner/webhooks.service';
import { flushRateLimits, signIn, startApp, TestCtx } from './helpers';
import { SITE_KEYS } from './env';

// The drop-in client partner sites copy (partner-kit/ijobs.ts), run against a real engine over HTTP.
// Loaded by path: it lives outside this package on purpose, so sites can copy it without the engine.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const kit = require(path.resolve(__dirname, '../../../partner-kit/ijobs.ts'));

const TAG = `pk${Date.now().toString(36)}`;

describe('Partner kit (partner-kit/ijobs.ts)', () => {
  let ctx: TestCtx;
  let apiUrl: string;
  let ijobs: any;
  const q = async (text: string, params: unknown[] = []) => (await ctx.admin.query(text, params)).rows;

  beforeAll(async () => {
    ctx = await startApp();
    await ctx.app.listen(0, '127.0.0.1');
    apiUrl = await ctx.app.getUrl();
    ijobs = kit.createIjobs({ siteKey: SITE_KEYS['remote-hustle'], apiUrl: apiUrl.replace('[::1]', '127.0.0.1') });
    ctx.app.get(WebhooksService).resolve = async (host: string) => (host === 'hooks.example.com' ? ['93.184.216.34'] : ['10.0.0.9']);
  });
  afterAll(() => ctx.close());
  beforeEach(() => flushRateLimits(ctx));

  it('refuses to start without a real site key, and a wrong key comes back as a clear error', async () => {
    expect(() => kit.createIjobs({ siteKey: '' })).toThrow(/siteKey/);
    const wrong = kit.createIjobs({ siteKey: 'sk_wrong_key', apiUrl });
    await expect(wrong.linkUser({ external_user_id: 'x', email: 'x@example.com', email_verified: true }))
      .rejects.toMatchObject({ name: 'IjobsError', status: 401, code: 'site_key_invalid' });
  });

  it('links a new user, then acts for them', async () => {
    const ext = `rh-${TAG}-1`;
    const email = `kit.${TAG}@example.com`;
    expect(await ijobs.linkUser({ external_user_id: ext, email, email_verified: true, full_name: 'Ada Okafor' }))
      .toMatchObject({ linked: true, user_id: expect.any(String) });
    const me = ijobs.forUser(ext);
    await expect(me.profile()).rejects.toMatchObject({ status: 404 }); // no CV yet
    const link = await me.cvUploadLink({ file_name: 'cv.pdf', content_type: 'application/pdf', size_bytes: 1200 });
    expect(link).toMatchObject({ upload_id: expect.any(String), upload_url: expect.any(String) });
    expect(await me.matches()).toMatchObject({ items: [] });
    expect(await me.applications()).toMatchObject({ items: [] });
    expect(await me.notifications()).toHaveProperty('items');
    await me.markNotificationsRead();
  });

  it('someone who already has an i-jobs account gets a consent link, and nothing is shared yet', async () => {
    const person = await signIn(ctx);
    const r = await ijobs.linkUser({ external_user_id: `rh-${TAG}-2`, email: person.email, email_verified: true });
    expect(r).toMatchObject({ linked: false, user_id: null, consent_url: expect.stringContaining('/link/') });
    await expect(ijobs.forUser(`rh-${TAG}-2`).matches()).rejects.toBeInstanceOf(kit.IjobsError);
  });

  it('unverified emails are refused with the API\'s own message', async () => {
    await expect(ijobs.linkUser({ external_user_id: `rh-${TAG}-3`, email: `u.${TAG}@example.com`, email_verified: false }))
      .rejects.toMatchObject({ status: 422, code: 'email_not_verified', title: expect.any(String) });
  });

  it('School1: a 15-year-old is locked until a parent approves, and the parent gets the email', async () => {
    const s1 = kit.createIjobs({ siteKey: SITE_KEYS.school1, apiUrl });
    const ext = `s1-${TAG}-teen`;
    const dob = `${new Date().getUTCFullYear() - 15}-01-15`;
    expect(await s1.linkUser({ external_user_id: ext, email: `teen.${TAG}@example.com`, email_verified: true, date_of_birth: dob })).toMatchObject({ linked: true });
    const me = s1.forUser(ext);
    expect(await me.account()).toMatchObject({ age_band: 'teen', features_locked: true });
    const parent = `parent.${TAG}@example.com`;
    expect(await me.requestParentApproval({ guardian_name: 'Mrs Okafor', guardian_email: parent })).toEqual({ status: 'sent' });
    expect(ctx.mail.outbox.some((m) => JSON.stringify(m).includes(parent))).toBe(true);
  });

  it('jobs, trainings and webhooks for the site', async () => {
    expect(await ijobs.jobs({ limit: 5 })).toHaveProperty('items');
    await ijobs.putTrainings([{ id: `c-${TAG}`, title: 'Zendesk basics', url: 'https://remotehustle.example/courses/zendesk', skills: ['zendesk'], is_free: true }]);
    const hook = await ijobs.webhooks.create('https://hooks.example.com/ijobs', ['match.created']);
    expect(hook.secret).toMatch(/^whsec_/);
    expect((await ijobs.webhooks.list()).map((h: any) => h.id)).toContain(hook.id);
    await ijobs.webhooks.remove(hook.id);
    expect((await q(`SELECT id FROM webhook_endpoints WHERE id = $1`, [hook.id]))).toEqual([]);
  });

  it('verifyWebhook accepts what the engine signs, and nothing else', () => {
    const body = JSON.stringify({ id: 'e1', type: 'match.created' });
    const header = signature('whsec_test', body);
    expect(kit.verifyWebhook(body, header, 'whsec_test')).toBe(true);
    expect(kit.verifyWebhook(body + ' ', header, 'whsec_test')).toBe(false);
    expect(kit.verifyWebhook(body, header, 'whsec_other')).toBe(false);
    expect(kit.verifyWebhook(body, signature('whsec_test', body, Math.floor(Date.now() / 1000) - 600), 'whsec_test')).toBe(false);
    expect(kit.verifyWebhook(body, undefined, 'whsec_test')).toBe(false);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { DEMO, errorsOf, one, signedInPage, sql, tag } from './helpers';

/** The demo owner (Tunde) runs Lagos Tech Hustlers. Steps share one signed-in page. */
test.describe.serial('a community owner', () => {
  let page: Page;
  const stuck = `Kemi${tag()}`;
  const base = `/app/owner/${DEMO.lagos}`;
  const tabs = () => page.getByRole('navigation', { name: 'Community' });

  test.beforeAll(async ({ browser }) => {
    // Make the demo state repeatable: tours unused, nobody reminded, the pasted job unchecked.
    await sql(`UPDATE communities SET demo_tours_used = 0, description = 'Remote tech jobs for Lagos.' WHERE id = $1`, [DEMO.lagos]);
    await sql(`UPDATE memberships SET last_nudged_at = NULL WHERE community_id = $1`, [DEMO.lagos]);
    await sql(`UPDATE jobs SET owner_confirmed_at = NULL, title = 'Social media assistant' WHERE id = $1`, [DEMO.pastedJob]);
    // A member stuck at the start, so there is someone to remind.
    const u = await one<{ id: string }>(`INSERT INTO users (email, email_verified_at, full_name, age_band) VALUES ($1, now(), $2, 'adult') RETURNING id`, [`stuck.${tag()}@example.com`, `${stuck} Okeke`]);
    await sql(`INSERT INTO memberships (user_id, community_id, status, source, onboarding_step) VALUES ($1, $2, 'pending_payment', 'invite_code', 'joined')`, [u.id, DEMO.lagos]);
    page = await signedInPage(browser, DEMO.owner);
  });
  test.afterAll(async () => { expect(errorsOf(page)).toEqual([]); });

  test('finds their communities from the sidebar', async () => {
    await page.getByRole('link', { name: 'My community' }).first().click();
    await expect(page).toHaveURL(/\/app\/owner$/);
    await page.getByRole('link', { name: /Lagos Tech Hustlers/ }).click();
    await expect(page).toHaveURL(new RegExp(`${base}$`));
    await expect(page.locator('#join-link')).toHaveValue(/\/join\/lagos-tech$/);
    await expect(page.locator('#invite-code')).toHaveValue('LTH-2048');
    await expect(page.getByText('How your members are doing')).toBeVisible();
  });

  test('makes a demo tour link anyone can open for a day', async ({ browser }) => {
    await page.getByRole('button', { name: 'Make a tour link' }).click();
    const url = await page.locator('#demo-link').inputValue();
    expect(url).toMatch(/\/demo\/[A-Za-z0-9_-]+$/);
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(url);
    await expect(visitor.getByText('A tour from')).toContainText('Lagos Tech Hustlers');
    await expect(visitor.getByRole('heading', { level: 1 })).toContainText('Meet Ada');
    await visitor.context().close();
  });

  test('sees first names only and reminds a stuck member', async () => {
    await tabs().getByRole('link', { name: 'Members', exact: true }).click();
    await expect(page.locator('table')).toContainText(stuck);
    await expect(page.locator('table')).not.toContainText('Okeke');
    await expect(page.locator('main')).not.toContainText('@example.com');
    await page.locator('tr', { hasText: stuck }).getByRole('button', { name: 'Remind' }).click();
    await expect(page.getByText('Reminder sent')).toBeVisible();
  });

  test('sends invites, and is told which ones it couldn’t read', async () => {
    await tabs().getByRole('link', { name: 'Invites', exact: true }).click();
    await page.fill('#targets', `invitee.${tag()}@example.com\n0803 555 ${String(Date.now()).slice(-4)}\nnot a contact`);
    await page.getByRole('button', { name: 'Send invites' }).click();
    await expect(page.getByRole('status')).toContainText('2 invites on the way');
    await expect(page.getByRole('status')).toContainText('not a contact');
  });

  test('checks and publishes a pasted job, then pastes another', async () => {
    await tabs().getByRole('link', { name: 'Jobs', exact: true }).click();
    const form = page.locator('form', { has: page.locator('input[name=apply_to]') }).first();
    await form.locator('input[name=title]').fill('Social media assistant (part time)');
    await form.getByRole('button', { name: /publish/ }).click();
    await expect.poll(async () => one(`SELECT title, owner_confirmed_at IS NOT NULL AS ok FROM jobs WHERE id = $1`, [DEMO.pastedJob])).toEqual({ title: 'Social media assistant (part time)', ok: true });
    await page.fill('#paste', 'We are hiring a remote bookkeeper at Ade & Co. You will reconcile accounts weekly and prepare monthly reports. Apply: careers@adeco.example');
    await page.getByRole('button', { name: 'Clean it up' }).click();
    await expect(page.getByRole('status').first()).toContainText('Got it');
  });

  test('buys Selar codes through Paga and downloads them', async () => {
    await tabs().getByRole('link', { name: 'Selar codes', exact: true }).click();
    await page.fill('#quantity', '3');
    await expect(page.getByText(/You pay ₦/)).toBeVisible();
    await page.locator('input[name=accept_terms]').check({ force: true });
    // With fake Paga, checkout is the web app's demo page.
    await page.getByRole('button', { name: 'Pay with Paga' }).click();
    await page.waitForURL(/\/demo-pay\//);
    await expect(page.getByRole('heading', { name: /^Pay ₦/ })).toBeVisible();
    await expect(page.getByText(/no money moves/)).toBeVisible();

    const pay = await one<{ id: string }>(`SELECT id FROM payments WHERE purpose = 'code_batch' AND community_id = $1 ORDER BY created_at DESC LIMIT 1`, [DEMO.lagos]);
    await page.goto(`/payments/${pay.id}`);
    await expect(page.getByText('Checking your payment')).toBeVisible();
    await page.goto(`/demo-pay/${pay.id}`);
    await page.getByRole('button', { name: 'Pay (demo)' }).click();
    await expect(page.getByRole('heading', { name: 'Your codes are ready' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Get the codes' }).click();

    const row = page.locator('tr', { hasText: 'Download CSV' }).first();
    await expect(row).toContainText('3');
    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('link', { name: 'Download CSV' }).click()]);
    const csv = await (await download.createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8'));
    expect(csv.trim().split('\n').filter((l) => /[A-Z0-9]{4}/.test(l)).length).toBeGreaterThanOrEqual(3);
  });

  test('sees earnings', async () => {
    await page.goto(`${base}/earnings`);
    await expect(page.getByText('Ready for your next payout')).toBeVisible();
    await expect(page.getByText(/You keep 70%/)).toBeVisible();
  });

  test('changes settings without losing the description', async () => {
    await page.goto(`${base}/settings`);
    await expect(page.locator('#description')).toHaveValue('Remote tech jobs for Lagos.');
    await page.fill('#description', 'Remote tech jobs for people in Lagos, shared every weekday.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    expect((await one(`SELECT description, price_kobo::int AS price FROM communities WHERE id = $1`, [DEMO.lagos]))).toEqual({ description: 'Remote tech jobs for people in Lagos, shared every weekday.', price: 500000 });
  });
});

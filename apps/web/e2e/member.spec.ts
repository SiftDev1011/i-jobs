import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { codeFor, DEMO, errorsOf, logMark, one, sql, tag, watchErrors } from './helpers';

/**
 * One new member, start to finish: join with an invite code, free week, CV, profile, autopilot,
 * matches, an application, notifications, help and settings. Steps share one signed-in page.
 */
test.describe.serial('a new member', () => {
  let page: Page;
  let userId: string;
  const email = `member.${tag()}@example.com`;
  const site = () => one<{ id: string }>(`SELECT id FROM sites WHERE slug = 'ijobs'`).then((r) => r.id);

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    watchErrors(page);
  });
  test.afterAll(async () => { expect(errorsOf(page)).toEqual([]); });

  test('signs up from an invite code and joins', async () => {
    await page.goto('/join/LTH-2048');
    await page.getByRole('link', { name: 'Continue' }).click();
    await page.fill('#target', email);
    const mark = logMark();
    await page.getByRole('button', { name: 'Send my code' }).click();
    await page.fill('#code', await codeFor(email, mark));
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/join\/LTH-2048/);
    await page.getByRole('button', { name: /Join Lagos Tech Hustlers/ }).click();
    await expect(page).toHaveURL(/\/app\?joined=/);
    userId = (await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).id;
    // Signing in records agreement to the terms and the privacy notice.
    expect((await sql(`SELECT purpose AS kind FROM consents WHERE user_id = $1 AND granted`, [userId])).map((r) => r.kind)).toEqual(expect.arrayContaining(['privacy', 'terms']));
  });

  test('starts the free week with a code texted to their phone', async () => {
    await page.getByRole('link', { name: 'Pay or start your free week' }).click();
    await expect(page).toHaveURL(/\/app\/membership\//);
    const local = `080${String(Date.now()).slice(-8)}`;
    await page.fill('#phone', local);
    const mark = logMark();
    await page.getByRole('button', { name: 'Text me a code' }).click();
    await page.fill('#trial-code', await codeFor(`+234${local.slice(1)}`, mark));
    await page.getByRole('button', { name: 'Start my free week' }).click();
    await expect(page).toHaveURL(/\/app\?trial=1/);
    expect((await one(`SELECT status FROM memberships WHERE user_id = $1`, [userId])).status).toBe('trialing');
  });

  test('uploads a CV straight to storage', async () => {
    await page.goto('/app/profile/cv');
    await page.getByLabel(/reads my CV/).check();
    await page.setInputFiles('input[type=file]', path.resolve(__dirname, '../../engine/test/fixtures/cv/cv.pdf'));
    await expect(page.getByText('Reading your CV…')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await one(`SELECT count(*)::int AS n FROM work_items WHERE user_id = $1 AND kind = 'cv_parse'`, [userId])).n).toBe(1);
  });

  test('edits and confirms the profile', async () => {
    // As if the worker had read the CV (reading needs an AI key).
    await sql(`INSERT INTO profiles (user_id, headline, skills, experience, strength, cv_parsed_at)
               VALUES ($1, 'Customer support specialist', '{zendesk,excel}', '[{"title":"Support agent","company":"Paylite","start":"2023-01","end":null,"highlights":["Answered 80 chats a day"]}]', 55, now())
               ON CONFLICT (user_id) DO NOTHING`, [userId]);
    await page.goto('/app/profile');
    await page.fill('#headline', 'Customer support specialist, 3 years in fintech');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByRole('button', { name: 'It’s accurate' }).click();
    await expect.poll(async () => (await one(`SELECT confirmed_at IS NOT NULL AS ok, headline FROM profiles WHERE user_id = $1`, [userId]))).toEqual({ ok: true, headline: 'Customer support specialist, 3 years in fintech' });
  });

  test('turns autopilot on, with the send-in-my-name consent', async () => {
    await page.goto('/app/autopilot');
    await page.locator('input[name=enabled]').check({ force: true });
    await page.locator('input[name=consent]').check({ force: true });
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    expect((await one(`SELECT enabled FROM autopilot_rules WHERE user_id = $1`, [userId])).enabled).toBe(true);
  });

  test('saves a match, opens it and reports the job', async () => {
    await sql(`INSERT INTO matches (user_id, job_id, score, reasons, gaps) VALUES
               ($1, $2, 88, '["Zendesk is one of your skills","Open worldwide"]', '[{"skill":"customer success"}]'),
               ($1, $3, 81, '["Live chat matches your experience"]', '[]') ON CONFLICT DO NOTHING`, [userId, DEMO.job(1), DEMO.job(18)]);
    await page.goto('/app/matches');
    await expect(page.getByRole('link', { name: 'View and apply' })).toHaveCount(2);
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    await page.getByRole('link', { name: 'View and apply' }).first().click();
    await expect(page).toHaveURL(/\/app\/jobs\//);
    await page.getByRole('button', { name: 'Report this job' }).click();
    await page.selectOption('#reason', 'wrong_details');
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('A moderator will look at it')).toBeVisible();
  });

  test('sees an application waiting to send and cancels it', async () => {
    const relay = await one<{ id: string }>(`INSERT INTO relay_addresses (user_id, local_part, domain) VALUES ($1, $2, 'apply.ijobs.example') RETURNING id`, [userId, `e2e${tag()}`]);
    const app = await one<{ id: string }>(`INSERT INTO applications (user_id, job_id, site_id, mode, channel, status, scheduled_for, cancel_until, relay_address_id, content)
      VALUES ($1, $2, $3, 'autopilot', 'email_relay', 'scheduled', now() + interval '2 hours', now() + interval '2 hours', $4,
              '{"subject":"Application: Customer success associate","body":"Hello Kora Labs team,\\n\\nI would like to apply…"}') RETURNING id`, [userId, DEMO.job(1), await site(), relay.id]);
    await page.goto('/app/applications');
    await expect(page.locator('main')).toContainText('Customer success associate');
    await page.goto(`/app/applications/${app.id}`);
    await expect(page.locator('main')).toContainText('I would like to apply');
    await page.getByRole('button', { name: 'Cancel it' }).click();
    await page.getByRole('button', { name: /Yes, don/ }).click();
    await expect.poll(async () => (await one(`SELECT status FROM applications WHERE id = $1`, [app.id])).status).toBe('cancelled');
  });

  test('reads notifications and marks them read', async () => {
    await sql(`INSERT INTO notifications (user_id, site_id, type, title, body, data) VALUES ($1, $2, 'reply.interview', 'Kora Labs wants to interview you', 'Check your email for the details.', '{}')`, [userId, await site()]);
    await page.goto('/app/notifications');
    await expect(page.getByText('Kora Labs wants to interview you')).toBeVisible();
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect.poll(async () => (await one(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId])).n).toBe(0);
  });

  test('gets a help answer, then writes to the team', async () => {
    await page.goto('/app/help');
    await page.getByLabel('Your question').fill('How do I upload my CV?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByText(/^From our help articles\./)).toBeVisible();
    await page.fill('#subject', 'Change my email');
    await page.fill('#message', 'I want to use a new email address.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/help\/tickets\//);
    await page.fill('#reply', 'The new one is ada@new.example');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.locator('ol li')).toHaveCount(2);
  });

  test('asks for a copy of their data', async () => {
    await page.goto('/app/settings');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/download link/)).toBeVisible();
    expect((await one(`SELECT type FROM data_requests WHERE user_id = $1`, [userId])).type).toBe('export');
  });

  test('cannot open owner or staff pages', async () => {
    expect((await page.goto('/app/admin'))?.status()).toBe(404);
    expect((await page.goto(`/app/owner/${DEMO.lagos}`))?.status()).toBe(404);
    await page.goto('/app');
    await expect(page.locator('aside')).not.toContainText(/Staff tools|My community|Hiring/);
  });

  test('signs out', async () => {
    await page.goto('/app/settings');
    await page.getByRole('button', { name: /Log out|Sign out/ }).first().click();
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

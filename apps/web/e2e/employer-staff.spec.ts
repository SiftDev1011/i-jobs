import { expect, test, type Page } from '@playwright/test';
import { codeFor, DEMO, errorsOf, logMark, one, signedInPage, sql, tag } from './helpers';

/**
 * Someone applies to run a community, a company verifies and posts a job, and a staff admin
 * reviews all three. Steps share pages so each person signs in once.
 */
test.describe.serial('owners apply, employers post, staff review', () => {
  const t = tag();
  const communityName = `Abuja Remote Crew ${t}`;
  const domain = `acme-${t}.example`;
  let applicant: Page;
  let employer: Page;
  let staff: Page;
  let communityId: string;
  let employerId: string;

  test.afterAll(async () => {
    for (const p of [applicant, employer, staff]) if (p) expect(errorsOf(p)).toEqual([]);
  });

  test('a signed-in person applies to run a community', async ({ browser }) => {
    applicant = await signedInPage(browser, `owner.${t}@example.com`, '/owners/apply');
    await expect(applicant).toHaveURL(/\/owners\/apply/);
    await applicant.fill('#legal_name', 'Amaka Eze');
    await applicant.selectOption('#id_type', 'nin');
    await applicant.fill('#id_number', String(Date.now()).slice(-11));
    await applicant.selectOption('#bank_code', '058');
    await applicant.fill('#bank_account_number', String(Date.now()).slice(-10));
    await applicant.fill('#community_name', communityName);
    await expect(applicant.locator('#slug')).toHaveValue(`abuja-remote-crew-${t}`);
    await applicant.fill('#proof_links', 'chat.whatsapp.com/AbujaRemote');
    await applicant.fill('#claimed_member_count', '320');
    await applicant.fill('#price', '6,000');
    await applicant.locator('input[name=trial_enabled]').check({ force: true });
    await applicant.locator('input[name=agree]').check({ force: true });
    await applicant.getByRole('button', { name: 'Send for review' }).click();
    await expect(applicant).toHaveURL(/\/app\/owner\/[0-9a-f-]+\?applied=1/);
    await expect(applicant.getByText('your application is in')).toBeVisible();
    communityId = applicant.url().match(/owner\/([0-9a-f-]+)/)![1];
    expect(await one(`SELECT status, price_kobo::int AS price, proof_links FROM communities WHERE id = $1`, [communityId]))
      .toEqual({ status: 'pending_review', price: 600000, proof_links: ['https://chat.whatsapp.com/AbujaRemote'] });
    // Not live yet, so nothing to share.
    await expect(applicant.locator('#join-link')).toHaveCount(0);
  });

  test('a price under the minimum is refused with a clear message', async () => {
    await applicant.goto('/owners/apply');
    await applicant.fill('#legal_name', 'Amaka Eze');
    await applicant.selectOption('#id_type', 'nin');
    await applicant.fill('#id_number', `X${Date.now()}`.slice(-11));
    await applicant.fill('#community_name', `Cheap Crew ${t}`);
    await applicant.fill('#proof_links', 'https://t.me/cheapcrew');
    await applicant.fill('#price', '100');
    await applicant.locator('input[name=agree]').check({ force: true });
    await applicant.getByRole('button', { name: 'Send for review' }).click();
    await expect(applicant.locator('.err').first()).toBeVisible();
    await expect(applicant).toHaveURL(/\/owners\/apply/);
  });

  test('a company confirms a work email and posts a job for review', async ({ browser }) => {
    employer = await signedInPage(browser, `hr@${domain}`, '/app/employer');
    await expect(employer).toHaveURL(/\/app\/employer$/);
    await employer.fill('#company_name', 'Acme Payments');
    await employer.fill('#website_url', domain);
    await employer.fill('#work_email', `hr@${domain}`);
    await employer.fill('#registry_number', 'RC 7654321');
    const mark = logMark();
    await employer.getByRole('button', { name: 'Email me a code' }).click();
    await employer.fill('#code', await codeFor(`hr@${domain}`, mark));
    await employer.getByRole('button', { name: 'Confirm' }).click();
    await expect(employer).toHaveURL(/\/app\/employer\/[0-9a-f-]+\?confirmed=1/);
    employerId = employer.url().match(/employer\/([0-9a-f-]+)/)![1];
    await expect(employer.getByText('Work email on your domain')).toBeVisible();

    await employer.getByRole('link', { name: 'Post a job' }).first().click();
    await employer.fill('#title', 'Customer Success Associate');
    await employer.fill('#description', 'Acme Payments is hiring a customer success associate to help merchants get set up and stay happy. You will answer questions by chat and email, run onboarding calls and write help articles.');
    await employer.fill('#pay_min', '350000');
    await employer.fill('#pay_max', '450000');
    await employer.fill('#skills', 'Zendesk, written English, onboarding');
    await employer.getByRole('button', { name: 'Post job' }).click();
    await expect(employer).toHaveURL(/\?posted=/);
    await expect(employer.getByText(/is in review/)).toBeVisible();
    expect(await one(`SELECT status, apply_email, salary_min_minor::int AS lo FROM jobs WHERE employer_id = $1`, [employerId]))
      .toEqual({ status: 'pending_review', apply_email: `hr@${domain}`, lo: 35000000 });
  });

  test('free email addresses can’t verify a company', async () => {
    await employer.goto(`/app/employer/${employerId}`);
    await employer.getByRole('link', { name: 'Hire for another company too' }).click();
    await employer.fill('#company_name', 'Gmail Co');
    await employer.fill('#website_url', 'example.com');
    await employer.fill('#work_email', `someone.${t}@gmail.com`);
    await employer.getByRole('button', { name: 'Email me a code' }).click();
    await expect(employer.getByRole('alert').filter({ hasText: /.+/ }).last()).toBeVisible();
    await expect(employer.locator('#code')).toHaveCount(0);
  });

  test('staff approve the community, the employer’s registration and the job', async ({ browser }) => {
    staff = await signedInPage(browser, DEMO.staff);
    await staff.getByRole('link', { name: 'Staff tools' }).first().click();
    await expect(staff.getByRole('navigation', { name: 'Staff tools' })).toContainText('AI budget');

    await staff.goto('/app/admin?subject=community');
    const c = staff.locator('li', { hasText: communityName }).first();
    await expect(c).toContainText('Owner: Amaka Eze');
    await expect(c).toContainText('Says it has 320 members');
    await c.getByRole('button', { name: 'Approve community' }).click();
    await expect(c.getByText('The owner has been emailed')).toBeVisible();
    expect((await one(`SELECT status FROM communities WHERE id = $1`, [communityId])).status).toBe('active');

    await staff.goto('/app/admin?subject=employer');
    const e = staff.locator('li', { hasText: `(${domain})` }).first();
    await e.getByRole('button', { name: 'Registration checks out' }).click();
    await expect(e.getByText('Decided.')).toBeVisible();
    expect((await one(`SELECT checks->>'registry' AS r FROM employers WHERE id = $1`, [employerId])).r).toBe('true');

    await staff.goto('/app/admin?subject=job');
    const j = staff.locator('li', { hasText: `hr@${domain}` }).first();
    await j.getByRole('button', { name: 'Approve' }).click();
    await expect(j.getByText('Decided.')).toBeVisible();
    const job = await one<{ id: string; status: string }>(`SELECT id, status FROM jobs WHERE employer_id = $1`, [employerId]);
    expect(job.status).toBe('live');

    // The job is public now, and the new owner's dashboard has links to share.
    await staff.goto(`/jobs/${job.id}`);
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Customer Success Associate');
    await applicant.goto(`/app/owner/${communityId}`);
    await expect(applicant.locator('#join-link')).toHaveValue(new RegExp(`/join/abuja-remote-crew-${t}$`));
  });

  test('staff take down a live job', async () => {
    const job = await one<{ id: string }>(`SELECT id FROM jobs WHERE employer_id = $1`, [employerId]);
    await staff.goto('/app/admin');
    await staff.getByText('Take down a live job').click();
    await staff.fill('#td-job', `http://localhost:3001/jobs/${job.id}`);
    await staff.selectOption('#td-reason', 'closed');
    await staff.getByRole('button', { name: 'Take down' }).click();
    await expect(staff.getByText('Taken down.')).toBeVisible();
    expect((await one(`SELECT status FROM jobs WHERE id = $1`, [job.id])).status).not.toBe('live');
  });

  test('staff answer a support ticket', async () => {
    const u = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`owner.${t}@example.com`]);
    const ticket = await one<{ id: string }>(`INSERT INTO support_tickets (user_id, site_id, subject, category, status) VALUES ($1, (SELECT id FROM sites WHERE slug = 'ijobs'), $2, 'payment', 'waiting_human') RETURNING id`, [u.id, `Charged twice ${t}`]);
    await sql(`INSERT INTO support_messages (ticket_id, author, body) VALUES ($1, 'user', 'I was charged twice for my membership.')`, [ticket.id]);
    await staff.goto('/app/admin/support');
    await staff.getByRole('link', { name: `Charged twice ${t}` }).click();
    await expect(staff.locator('main')).toContainText('I was charged twice');
    await staff.fill('#body', 'Sorry about that — the second charge has been refunded.');
    await staff.locator('input[name=resolve]').check({ force: true });
    await staff.getByRole('button', { name: 'Send reply' }).click();
    await expect(staff.getByText('Sent.')).toBeVisible();
    expect((await one(`SELECT status FROM support_tickets WHERE id = $1`, [ticket.id])).status).toBe('resolved');
    expect((await one(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'support.reply'`, [u.id])).n).toBe(1);
  });

  test('every staff tab opens for an admin', async () => {
    for (const [path, text] of [['/app/admin/data-requests', /requests|Nothing|No open/], ['/app/admin/payouts', 'Release a payout'], ['/app/admin/sources', 'Where jobs come from'], ['/app/admin/ai-budget', 'token allowance']] as const) {
      await staff.goto(path);
      await expect(staff.locator('main'), path).toContainText(text);
    }
  });

  test('a moderator only sees the tabs for their role', async ({ browser }) => {
    const email = `mod.${t}@example.com`;
    const u = await one<{ id: string }>(`INSERT INTO users (email, email_verified_at, full_name, age_band) VALUES ($1, now(), 'Musa Mod', 'adult') RETURNING id`, [email]);
    await sql(`INSERT INTO staff_members (user_id, role) VALUES ($1, 'moderator')`, [u.id]);
    const mod = await signedInPage(browser, email, '/app/admin');
    const nav = mod.getByRole('navigation', { name: 'Staff tools' });
    await expect(nav).toContainText('Review queue');
    await expect(nav).not.toContainText('Payouts');
    await expect(nav).not.toContainText('AI budget');
    await mod.goto('/app/admin/payouts');
    await expect(mod).toHaveURL(/\/app\/admin$/);
    expect(errorsOf(mod)).toEqual([]);
    await mod.context().close();
  });
});

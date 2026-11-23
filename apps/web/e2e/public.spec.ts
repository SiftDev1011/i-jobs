import { expect, test } from '@playwright/test';
import { DEMO, errorsOf, watchErrors } from './helpers';

test.beforeEach(({ page }) => { watchErrors(page); });
test.afterEach(({ page }) => { expect(errorsOf(page)).toEqual([]); });

test('landing: hero, job wall and search', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('jobs for you');
  // The wall shows real job finds from the engine (the demo seed has 20).
  await expect(page.locator('article').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search jobs' }).first().fill('support');
  await page.getByRole('button', { name: 'Search' }).first().click();
  await expect(page).toHaveURL(/\/jobs\?q=support/);
});

test('jobs: search, filter and open a job', async ({ page }) => {
  await page.goto('/jobs?q=engineer');
  const first = page.locator('article h3 a').first();
  await expect(first).toBeVisible();
  const title = (await first.innerText()).trim();
  await first.click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
});

test('communities: find one and open its join page with the price', async ({ page }) => {
  await page.goto('/communities');
  await page.getByLabel('Search communities').fill('Lagos');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: /Lagos Tech Hustlers/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lagos Tech Hustlers');
  // Prices appear on join pages only.
  await expect(page.getByText(/₦[\d,]+/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', /\/sign-in\?next=/);
});

test('an invite code opens the same join page', async ({ page }) => {
  await page.goto('/join/LTH-2048');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lagos Tech Hustlers');
  await page.goto('/join/NOPE-0000');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('couldn’t find that invite');
});

test('help search finds an article', async ({ page }) => {
  await page.goto('/help?q=CV');
  await expect(page.locator('main')).toContainText(/CV/);
});

test('explainer pages never show membership prices', async ({ page }) => {
  for (const path of ['/communities', '/employers', '/owners/apply', '/about', '/help']) {
    await page.goto(path);
    await expect(page.locator('main'), path).not.toContainText('₦');
  }
});

test('running a community: signed-out visitors are asked to log in first', async ({ page }) => {
  await page.goto('/owners/apply');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your job group');
  await expect(page.getByRole('link', { name: 'Log in to apply' })).toHaveAttribute('href', /^\/sign-in\?next=\/owners\/apply/);
});

test('employers page leads to verification', async ({ page }) => {
  await page.goto('/employers');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hire remote talent');
  await expect(page.getByRole('link', { name: 'Verify your company' })).toHaveAttribute('href', '/sign-in?next=/app/employer');
});

test('content pages render from Markdown, with anchors the forms link to', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About i-jobs');
  await page.goto('/terms#owners');
  await expect(page.locator('h2#owners')).toBeVisible();
  await expect(page.locator('h2#employers')).toHaveCount(1);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
});

test('a demo tour link that has ended is a 404', async ({ page }) => {
  const r = await page.goto('/demo/not-a-real-token');
  expect(r?.status()).toBe(404);
});

test('signed-out visitors are sent to sign in from the app', async ({ page }) => {
  await page.goto('/app/matches');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fmatches/);
  await page.goto(`/app/owner/${DEMO.lagos}`);
  await expect(page).toHaveURL(/\/sign-in/);
});

test('unknown pages are a friendly 404', async ({ page }) => {
  const r = await page.goto('/this-does-not-exist');
  expect(r?.status()).toBe(404);
  await expect(page.locator('body')).toContainText(/couldn’t find|not found/i);
});

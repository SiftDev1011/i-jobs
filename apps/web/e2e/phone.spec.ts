import { expect, test } from '@playwright/test';
import { DEMO, errorsOf, scrollsSideways, signIn, watchErrors } from './helpers';

/** Every kind of page fits a phone screen: nothing scrolls sideways (tables scroll inside their box). */
test.describe('on a phone', () => {
  test.beforeEach(({ page }) => { watchErrors(page); });
  test.afterEach(({ page }) => { expect(errorsOf(page)).toEqual([]); });

  test('public pages', async ({ page }) => {
    for (const path of ['/', '/jobs', '/communities', '/join/LTH-2048', '/help', '/employers', '/owners/apply', '/about', '/terms', '/sign-in']) {
      await page.goto(path);
      expect(await scrollsSideways(page), path).toBe(false);
    }
  });

  test('the landing hero search fits', async ({ page }) => {
    await page.goto('/');
    const box = await page.getByRole('searchbox', { name: 'Search jobs' }).first().boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test('owner pages, with bottom tabs and the More sheet', async ({ page }) => {
    await signIn(page, DEMO.owner);
    for (const tab of ['', '/members', '/invites', '/jobs', '/earnings', '/codes', '/settings']) {
      await page.goto(`/app/owner/${DEMO.lagos}${tab}`);
      expect(await scrollsSideways(page), tab || 'overview').toBe(false);
    }
    const tabs = page.getByRole('navigation', { name: 'App' }).last();
    await expect(tabs).toBeVisible();
    await tabs.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('link', { name: 'My community' }).last()).toBeVisible();
  });

  test('staff pages', async ({ page }) => {
    await signIn(page, DEMO.staff);
    for (const path of ['/app/admin', '/app/admin/support', '/app/admin/data-requests', '/app/admin/payouts', '/app/admin/sources', '/app/admin/ai-budget']) {
      await page.goto(path);
      expect(await scrollsSideways(page), path).toBe(false);
    }
  });
});

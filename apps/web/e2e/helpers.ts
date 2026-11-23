import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { expect, type Browser, type Page } from '@playwright/test';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { E2E } from './env';

export const DEMO = {
  owner: 'owner@demo.ijobs.example',
  staff: 'staff@demo.ijobs.example',
  lagos: '22222222-2222-4222-8222-222222222221',
  pastedJob: '33333333-3333-4333-8333-0000000000a1',
  job: (n: number) => `33333333-3333-4333-8333-0000000000${String(n).padStart(2, '0')}`,
};

/** A unique bit for emails, slugs and numbers. */
export const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const pool = new Pool({ connectionString: E2E.databaseAdminUrl, max: 2 });
/** Runs SQL as the database owner (seeding and checking, never what the app does). */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}
export const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0];

export async function clearRateLimits() {
  const r = new Redis(E2E.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await r.connect();
  const keys = await r.keys('rl:*');
  if (keys.length) await r.del(...keys);
  r.disconnect();
}

/** Where the engine log ends now. Pass it to codeFor so only codes sent after this point count. */
export const logMark = () => (existsSync(E2E.engineLog) ? statSync(E2E.engineLog).size : 0);

/** The newest 6-digit code the engine logged for this email or phone number (after `since`). */
export async function codeFor(target: string, since = 0): Promise<string> {
  let found: string | null = null;
  await expect.poll(() => {
    if (!existsSync(E2E.engineLog)) return null;
    const log = readFileSync(E2E.engineLog).subarray(since).toString('utf8');
    const at = log.lastIndexOf(`to=${target}`);
    found = at >= 0 ? (log.slice(at, at + 2000).match(/\b(\d{6})\b/)?.[1] ?? null) : null;
    return found;
  }, { message: `a code for ${target} in ${E2E.engineLog}`, timeout: 10_000 }).not.toBeNull();
  return found!;
}

/** Signs in with an emailed code on /sign-in and waits to leave the page. */
export async function signIn(page: Page, email: string, next = '/app') {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.fill('#target', email);
  const mark = logMark();
  await page.getByRole('button', { name: 'Send my code' }).click();
  await expect(page.locator('#code')).toBeVisible();
  await page.fill('#code', await codeFor(email, mark));
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'));
}

/** A new browser context signed in as this email, for tests that share one session. */
export async function signedInPage(browser: Browser, email: string, next = '/app') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watchErrors(page);
  await signIn(page, email, next);
  return page;
}

/** Collects page crashes and server errors so a test can assert there were none. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  (page as Page & { errors: string[] }).errors = errors;
  return errors;
}
export const errorsOf = (page: Page) => (page as Page & { errors?: string[] }).errors ?? [];

/** Completes a payment the way Paga's callback would, signed with the test hash key. */
export async function payWithFakePaga(paymentId: string) {
  const p = await one<{ provider_ref: string; amount_kobo: string }>(`SELECT provider_ref, amount_kobo FROM payments WHERE id = $1`, [paymentId]);
  const c = { notificationId: `e2e-${paymentId}`, statusCode: '0', externalReferenceNumber: p.provider_ref, state: 'COMPLETE', event: 'PAYMENT_COMPLETE', outstandingBalance: null, paymentAmount: Number(p.amount_kobo) / 100, collectionFee: 0 };
  const hash = createHash('sha512').update(`${c.notificationId}${c.statusCode}${c.externalReferenceNumber}${c.state}${E2E.engineEnv.PAGA_HASH_KEY}`).digest('hex');
  const r = await fetch(`${E2E.engineUrl}/v1/hooks/paga`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c, hash }) });
  expect(r.ok, `Paga callback: ${r.status} ${await r.text()}`).toBe(true);
}

/** True if the page scrolls sideways (it never should). */
export const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

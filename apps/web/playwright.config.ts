import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { E2E } from './e2e/env';

/**
 * Browser tests against a real engine and the built web app.
 *
 *   npm run build -w @ijobs/engine && npm run build -w @ijobs/web
 *   npm run e2e -w @ijobs/web
 *
 * The suite migrates and seeds the database in DATABASE_ADMIN_URL, starts the engine (console mail
 * and SMS, fake Paga, local file storage) and `next start`, and reads sign-in codes from the
 * engine's log. With servers already running, set E2E_START_SERVERS=0 and E2E_ENGINE_LOG to the
 * engine's log file. See e2e/README.md.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.out/results',
  // The tests share one database and the demo owner, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.out/report' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E.webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
  },
  projects: [
    { name: 'desktop', testIgnore: /phone\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } },
    { name: 'phone', testMatch: /phone\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: E2E.startServers
    ? [
        {
          // The engine writes to a log file the tests read sign-in codes from.
          command: `sh -c 'mkdir -p "${path.dirname(E2E.engineLog)}" && exec node ../engine/dist/main.js > "${E2E.engineLog}" 2>&1'`,
          url: `${E2E.engineUrl}/v1/health`,
          env: E2E.engineEnv,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `npx next start -p ${new URL(E2E.webUrl).port || 3001}`,
          url: E2E.webUrl,
          env: { ENGINE_URL: E2E.engineUrl, PUBLIC_APP_URL: E2E.webUrl },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ]
    : undefined,
});

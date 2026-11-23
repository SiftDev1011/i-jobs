import { defineConfig } from '@playwright/test';

/** Unit tests for the helpers in src/lib: no browser, no servers. `server-only` is stubbed. */
export default defineConfig({
  testDir: './test',
  testMatch: /\.test\.ts$/,
  tsconfig: './tsconfig.unit.json',
  outputDir: './e2e/.out/unit',
  reporter: 'list',
  use: { timezoneId: 'Africa/Lagos' },
});

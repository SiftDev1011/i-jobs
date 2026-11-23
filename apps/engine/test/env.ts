/**
 * Test settings. Override with:
 *   TEST_PG_ADMIN_URL   a superuser connection (default postgres://postgres@127.0.0.1:54329/postgres)
 *   TEST_REDIS_URL      default redis://127.0.0.1:63799/15
 *   TEST_APP_PASSWORD   password for the ijobs_app role (default app-dev-password)
 */
export const TEST_DB = 'ijobs_test';
export const adminUrl = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
export const appPassword = process.env.TEST_APP_PASSWORD ?? 'app-dev-password';

export function testDbUrl(user?: { name: string; password: string }) {
  const u = new URL(adminUrl);
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

export const SITE_KEYS = {
  'remote-hustle': 'sk_test_remote_hustle_0123456789abcdef0123456789',
  school1: 'sk_test_school1_0123456789abcdef0123456789abcdef',
};

/** Shared with the Cloudflare email worker in production; any long value in tests. */
export const INBOUND_SECRET = 'test-inbound-secret-0123456789abcdef0123456789';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDbUrl({ name: 'ijobs_app', password: appPassword }),
  DATABASE_ADMIN_URL: testDbUrl(),
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:63799/15',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-0123456789',
  AUTH_PEPPER: 'test-pepper-that-is-long-enough-0123456789abcd',
  MAIL_DRIVER: 'console',
  SMS_DRIVER: 'console',
  TRUST_PROXY: 'false',
  INBOUND_EMAIL_SECRET: INBOUND_SECRET,
});

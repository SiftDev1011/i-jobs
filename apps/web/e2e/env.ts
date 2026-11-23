import path from 'node:path';

const env = process.env;
const engineUrl = env.E2E_ENGINE_URL ?? 'http://localhost:3000';
const webUrl = env.E2E_WEB_URL ?? 'http://localhost:3001';

/** Settings for the browser tests. Database and Redis come from the same variables the engine uses. */
export const E2E = {
  engineUrl,
  webUrl,
  startServers: env.E2E_START_SERVERS !== '0',
  engineLog: path.resolve(__dirname, env.E2E_ENGINE_LOG ?? '.out/engine.log'),
  databaseAdminUrl: env.DATABASE_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/ijobs',
  redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379/0',
  /** What the engine is started with. Test-only secrets are filled in if you haven't set your own. */
  engineEnv: {
    NODE_ENV: 'development',
    PORT: new URL(engineUrl).port || '3000',
    DATABASE_URL: env.DATABASE_URL ?? 'postgres://ijobs_app:dev@127.0.0.1:54329/ijobs',
    DATABASE_ADMIN_URL: env.DATABASE_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/ijobs',
    REDIS_URL: env.REDIS_URL ?? 'redis://127.0.0.1:6379/0',
    JWT_SECRET: env.JWT_SECRET ?? 'e2e-jwt-secret-that-is-long-enough-0123456789',
    AUTH_PEPPER: env.AUTH_PEPPER ?? 'e2e-pepper-that-is-long-enough-0123456789abcd',
    PUBLIC_APP_URL: webUrl,
    PUBLIC_API_URL: engineUrl,
    MAIL_DRIVER: 'console',
    SMS_DRIVER: 'console',
    PAGA_DRIVER: 'fake',
    PAGA_HASH_KEY: env.PAGA_HASH_KEY ?? 'e2e-paga-hash-key',
    STORAGE_DRIVER: 'local',
    STORAGE_DIR: path.resolve(__dirname, '.out/storage'),
    INGEST_ENABLED: 'false',
    LOG_LEVEL: 'info',
  } as Record<string, string>,
};

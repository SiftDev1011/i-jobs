import { resolve } from 'node:path';
import Redis from 'ioredis';
import { Client } from 'pg';
import { sha256Hex } from '../src/common/crypto';
import { migrate } from '../src/migrate';
import { adminUrl, appPassword, SITE_KEYS, TEST_DB, testDbUrl } from './env';

/** Fresh test database for every run: migrations, seeds, the app role and known site keys. */
export default async function globalSetup() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijobs_app') THEN
      CREATE ROLE ijobs_app LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF; END $$`);
  await admin.query(`ALTER ROLE ijobs_app WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
  await admin.end();

  const root = resolve(__dirname, '../../..');
  await migrate({
    url: testDbUrl(),
    migrationsDir: resolve(root, 'db/migrations'),
    seedsDir: resolve(root, 'db/seeds'),
    seed: true,
    log: () => undefined,
  });

  const db = new Client({ connectionString: testDbUrl() });
  await db.connect();
  for (const [slug, key] of Object.entries(SITE_KEYS)) {
    await db.query('UPDATE sites SET api_key_hash = $1 WHERE slug = $2', [sha256Hex(key), slug]);
  }
  await db.end();

  const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:63799/15');
  await redis.flushdb();
  redis.disconnect();
}

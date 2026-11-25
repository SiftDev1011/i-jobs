import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import Redis from 'ioredis';
import { E2E } from './env';

/** Migrates the database, loads the shared reference data and the dev demo data, and clears rate limits. */
export default async function globalSetup() {
  const root = path.resolve(__dirname, '../../..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { migrate } = require(path.join(root, 'apps/engine/dist/migrate.js')) as { migrate: (o: object) => Promise<unknown> };
  await migrate({ url: E2E.databaseAdminUrl, migrationsDir: path.join(root, 'db/migrations'), seedsDir: path.join(root, 'db/seeds'), seed: true, log: () => {} });

  const db = new Client({ connectionString: E2E.databaseAdminUrl, options: '-c TimeZone=UTC' });
  await db.connect();
  try {
    await db.query(readFileSync(path.join(root, 'db/seeds/dev/demo.sql'), 'utf8'));
  } finally {
    await db.end();
  }
  const redis = new Redis(E2E.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

/**
 * Applies db/migrations/*.sql in order, once each, then (with --seed) re-runs
 * db/seeds/*.sql, which are safe to repeat.
 *
 *   node dist/migrate.js            apply new migrations
 *   node dist/migrate.js --seed     apply new migrations, then the seeds
 *
 * Uses DATABASE_ADMIN_URL (the table owner) when set, else DATABASE_URL.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

function dirFrom(envName: string, fallback: string): string {
  return resolve(process.env[envName] ?? resolve(__dirname, fallback));
}

export async function migrate(opts: { url: string; migrationsDir: string; seedsDir?: string; seed?: boolean; log?: (m: string) => void }) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const client = new Client({ connectionString: opts.url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // One migrator at a time, even if two containers start together.
    await client.query('SELECT pg_advisory_lock(8473021)');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(opts.migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(opts.migrationsDir, file), 'utf8');
      log(`Applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    log(applied ? `Applied ${applied} migration(s).` : 'Database is up to date.');

    if (opts.seed && opts.seedsDir) {
      for (const file of readdirSync(opts.seedsDir).filter((f) => f.endsWith('.sql')).sort()) {
        log(`Seeding ${file}`);
        await client.query(readFileSync(join(opts.seedsDir, file), 'utf8'));
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(8473021)').catch(() => undefined);
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_ADMIN_URL or DATABASE_URL.');
    process.exit(1);
  }
  migrate({
    url,
    migrationsDir: dirFrom('MIGRATIONS_DIR', '../../../db/migrations'),
    seedsDir: dirFrom('SEEDS_DIR', '../../../db/seeds'),
    seed: process.argv.includes('--seed'),
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

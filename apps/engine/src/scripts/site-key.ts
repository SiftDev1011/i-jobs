/**
 * Issues a new key for a partner site and stores only its hash.
 *
 *   node dist/scripts/site-key.js remote-hustle
 *
 * Prints the key once. Give it to that site's developers to keep in their server's
 * environment. Running it again replaces the old key, which stops working immediately.
 */
import { Client } from 'pg';
import { randomToken, sha256Hex } from '../common/crypto';

async function main() {
  const slug = process.argv[2];
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!slug || !url) {
    console.error('Usage: DATABASE_URL=... node dist/scripts/site-key.js <site-slug>');
    process.exit(1);
  }
  const key = `sk_${slug.replace(/[^a-z0-9]/g, '')}_${randomToken(32)}`;
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query('UPDATE sites SET api_key_hash = $1 WHERE slug = $2 RETURNING name', [sha256Hex(key), slug]);
  await client.end();
  if (!res.rowCount) {
    console.error(`No site with slug "${slug}".`);
    process.exit(1);
  }
  console.log(`New key for ${res.rows[0].name}. It is shown once:\n\n${key}\n`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

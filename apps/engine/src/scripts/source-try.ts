/**
 * Fetch one source live and print what we'd make of each job. Writes nothing.
 * Use it before enabling a source or a company board, and whenever a source's format changes.
 *
 *   node dist/scripts/source-try.js remotive
 *   node dist/scripts/source-try.js greenhouse gitlab
 *   node dist/scripts/source-try.js adzuna --config '{"countries":["gb"],"pages":1}'
 *   node dist/scripts/source-try.js himalayas --raw        # also print the first raw item
 *
 * Credentials come from the usual environment variables (ADZUNA_APP_ID, JOOBLE_API_KEY, ...).
 */
import { loadConfig } from '../config/config';
import { CONNECTORS } from '../ingest/connectors';
import { Http } from '../ingest/http';
import { tagLocation } from '../ingest/location';
import { categorise, employmentType } from '../ingest/normalise';
import { isSkip } from '../ingest/types';

async function main() {
  const args = process.argv.slice(2);
  const key = args[0];
  const boardToken = args[1] && !args[1].startsWith('--') ? args[1] : null;
  const confIdx = args.indexOf('--config');
  const conf = confIdx >= 0 ? JSON.parse(args[confIdx + 1]) : {};
  const showRaw = args.includes('--raw');
  const connector = key ? CONNECTORS.get(key) : undefined;
  if (!connector) {
    console.error(`Usage: source-try <source> [board] [--config JSON] [--raw]\nSources: ${[...CONNECTORS.keys()].join(', ')}`);
    process.exit(1);
  }
  if (connector.perBoard && !boardToken) {
    console.error(`${key} needs a company board, e.g. source-try ${key} <board-token>`);
    process.exit(1);
  }

  const config = loadConfig({
    DATABASE_URL: 'unused', REDIS_URL: 'unused', JWT_SECRET: 'x'.repeat(32), AUTH_PEPPER: 'x'.repeat(32),
    ...process.env, NODE_ENV: 'development',
  });
  const missing = connector.missingCredentials?.(config);
  if (missing) {
    console.error(missing);
    process.exit(1);
  }

  const source = { key, name: key, kind: '', config: conf, excluded_origins: [], default_expiry_days: 30, apply_via_source_link: false, needs_ai_extraction: false };
  const board = boardToken ? { id: 'try', board_token: boardToken, company_name: null } : null;
  const http = new Http(config.INGEST_USER_AGENT, config.INGEST_HTTP_TIMEOUT_MS);
  const started = Date.now();
  const { items, complete } = await connector.fetch({ source, board, http, config, known: new Set() });
  console.log(`${items.length} items in ${Date.now() - started} ms (complete listing: ${complete})\n`);
  if (showRaw && items[0]) console.log('First raw item:\n', JSON.stringify(items[0].payload, null, 2).slice(0, 4000), '\n');

  const skips: Record<string, number> = {};
  for (const item of items.slice(0, 15)) {
    const n = connector.normalise(item.payload, { source, board });
    if (isSkip(n)) {
      skips[n.skip] = (skips[n.skip] ?? 0) + 1;
      continue;
    }
    const where = tagLocation(n.location);
    const employment = employmentType(...(n.employmentHints ?? []));
    console.log(`• ${n.title || '(AI will read the title)'} — ${n.company || '?'}`);
    console.log(`  ${where.isRemote ? 'remote' : 'on-site'} · ${where.scope}${where.countries.length ? ` · ${where.countries.join(',')}` : ''}${where.regions.length ? ` · ${where.regions.join(',')}` : ''}${where.tzMin !== null ? ` · UTC${where.tzMin}..${where.tzMax}` : ''}`);
    console.log(`  ${employment ?? 'type ?'} · ${categorise({ title: n.title, employment, sourceLabels: n.labels })} · posted ${n.postedAt?.toISOString().slice(0, 10) ?? '?'}${n.pay?.currency ? ` · pay ${n.pay.currency} ${n.pay.minMinor ?? ''}-${n.pay.maxMinor ?? ''} /${n.pay.period ?? '?'} (minor units)` : ''}`);
    console.log(`  apply: ${n.applyEmail ?? n.applyUrl ?? n.sourceUrl ?? '-'}`);
    console.log(`  ${n.description.replace(/\s+/g, ' ').slice(0, 160)}${n.needsAi ? '  [needs AI]' : ''}\n`);
  }
  if (Object.keys(skips).length) console.log('Skipped:', skips);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { connectorFor } from './connectors';
import { Http, HttpError } from './http';
import { BoardRow, ConnectorUnavailable, RawItem, SourceRow } from './types';

export interface FetchUnit {
  sourceKey: string;
  boardId: string | null;
}

export interface RunStats {
  runId: string;
  ok: boolean;
  skipped?: string;
  fetched: number;
  created: number;
  updated: number;
  closed: number;
  error?: string;
}

const BOARD_FAILURES_BEFORE_OFF = 5;

/**
 * Fetching: decides which sources and boards are due, pulls them, and keeps raw_postings
 * in step with each source (new, changed, still there, gone). Turning raw postings into
 * jobs is PipelineService's job.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger('Ingest');

  constructor(
    private readonly db: Db,
    private readonly http: Http,
    private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Sources and boards whose interval has passed and that haven't hit today's fetch cap. */
  async dueUnits(now = new Date()): Promise<FetchUnit[]> {
    const sources = await this.db.asEngine((trx) =>
      trx
        .selectFrom('sources as s')
        .leftJoin('source_health as h', 'h.key', 's.key')
        .select(['s.key', 's.fetch_interval_minutes', 's.max_fetches_per_day', 'h.runs_today'])
        .where('s.enabled', '=', true)
        .where('s.display', '!=', 'disabled')
        .where('s.terms_status', '!=', 'blocked')
        .execute(),
    );
    const units: FetchUnit[] = [];
    for (const s of sources) {
      const connector = connectorFor(s.key);
      if (!connector || connector.internal) continue; // internal sources arrive through the API
      if (connector.missingCredentials?.(this.config)) continue;
      if (s.max_fetches_per_day && (s.runs_today ?? 0) >= s.max_fetches_per_day) continue;
      const cutoff = new Date(now.getTime() - s.fetch_interval_minutes * 60_000);

      if (connector.perBoard) {
        const boards = await this.db.asEngine((trx) =>
          trx
            .selectFrom('source_boards')
            .select('id')
            .where('source_key', '=', s.key)
            .where('enabled', '=', true)
            .where((eb) => eb.or([eb('last_fetched_at', 'is', null), eb('last_fetched_at', '<', cutoff)]))
            .orderBy('last_fetched_at', (ob) => ob.asc().nullsFirst())
            .limit(50)
            .execute(),
        );
        units.push(...boards.map((b) => ({ sourceKey: s.key, boardId: b.id })));
      } else {
        const last = await this.db.asEngine((trx) =>
          trx.selectFrom('source_runs').select('started_at').where('source_key', '=', s.key).orderBy('started_at', 'desc').limit(1).executeTakeFirst(),
        );
        if (!last || new Date(last.started_at as unknown as string) < cutoff) units.push({ sourceKey: s.key, boardId: null });
      }
    }
    return units;
  }

  /** Reserve a unit so two ticks never queue it twice. Released when the fetch ends. */
  async claim(unit: FetchUnit): Promise<boolean> {
    return (await this.redis.client.set(lockKey(unit), '1', 'EX', 1800, 'NX')) === 'OK';
  }

  async release(unit: FetchUnit) {
    await this.redis.client.del(lockKey(unit));
  }

  async fetchUnit(unit: FetchUnit): Promise<RunStats> {
    const connector = connectorFor(unit.sourceKey);
    if (!connector) throw new Error(`No connector for ${unit.sourceKey}`);
    const source = (await this.db.asEngine((trx) =>
      trx
        .selectFrom('sources')
        .select(['key', 'name', 'kind', 'config', 'excluded_origins', 'default_expiry_days', 'apply_via_source_link', 'needs_ai_extraction'])
        .where('key', '=', unit.sourceKey)
        .executeTakeFirstOrThrow(),
    )) as unknown as SourceRow;
    const board = unit.boardId
      ? ((await this.db.asEngine((trx) =>
          trx.selectFrom('source_boards').select(['id', 'board_token', 'company_name']).where('id', '=', unit.boardId!).executeTakeFirstOrThrow(),
        )) as BoardRow)
      : null;

    const run = await this.db.asEngine((trx) =>
      trx.insertInto('source_runs').values({ source_key: unit.sourceKey, board_id: unit.boardId }).returning(['id', 'started_at']).executeTakeFirstOrThrow(),
    );
    const runId = String(run.id);
    const startedAt = new Date(run.started_at as unknown as string);
    const stats: RunStats = { runId, ok: false, fetched: 0, created: 0, updated: 0, closed: 0 };

    const missing = connector.missingCredentials?.(this.config);
    if (missing) {
      stats.skipped = missing;
      await this.finishRun(stats, unit, missing);
      return stats;
    }

    try {
      const known = await this.knownIds(unit);
      const { items, complete } = await connector.fetch({ source, board, http: this.http, config: this.config, known });
      stats.fetched = items.length;
      const counts = await this.store(unit, items);
      stats.created = counts.created;
      stats.updated = counts.updated;
      // A complete listing that suddenly comes back empty is more likely a fault than every job closing.
      if (complete && (items.length > 0 || known.size === 0)) stats.closed = await this.markGone(unit, startedAt);
      stats.ok = true;
      await this.finishRun(stats, unit, null);
    } catch (e) {
      const msg = e instanceof HttpError || e instanceof ConnectorUnavailable ? e.message : `${(e as Error).name}: ${(e as Error).message}`;
      stats.error = msg.slice(0, 500);
      await this.finishRun(stats, unit, stats.error);
      this.logger.warn(`${unit.sourceKey}${board ? `/${board.board_token}` : ''} failed: ${stats.error}`);
    }
    return stats;
  }

  private async knownIds(unit: FetchUnit): Promise<Set<string>> {
    const rows = await this.db.asEngine((trx) =>
      trx
        .selectFrom('raw_postings')
        .select('external_id')
        .where('source_key', '=', unit.sourceKey)
        .where((eb) => (unit.boardId ? eb('board_id', '=', unit.boardId) : eb('board_id', 'is', null)))
        .where('gone_at', 'is', null)
        .execute(),
    );
    return new Set(rows.map((r) => r.external_id));
  }

  /** Insert new postings, refresh changed ones (they go back to "new" for processing), touch the rest. */
  private async store(unit: FetchUnit, items: RawItem[]): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    const seen = new Set<string>();
    const unique = items.filter((i) => i.externalId && !seen.has(i.externalId) && seen.add(i.externalId));

    const touch = unique.filter((i) => i.touchOnly).map((i) => i.externalId);
    if (touch.length) {
      await this.db.asEngine((trx) =>
        trx
          .updateTable('raw_postings')
          .set({ last_seen_at: sql`now()`, gone_at: null })
          .where('source_key', '=', unit.sourceKey)
          .where('external_id', 'in', touch)
          .execute(),
      );
    }

    const full = unique.filter((i) => !i.touchOnly);
    for (let i = 0; i < full.length; i += 100) {
      const batch = full.slice(i, i + 100).map((item) => ({
        source_key: unit.sourceKey,
        board_id: unit.boardId,
        external_id: item.externalId.slice(0, 500),
        url: item.url ?? null,
        payload: JSON.stringify(item.payload),
        content_hash: createHash('sha256').update(JSON.stringify(item.payload)).digest('hex'),
      }));
      const rows = await this.db.asEngine((trx) =>
        trx
          .insertInto('raw_postings')
          .values(batch)
          .onConflict((oc) =>
            oc.columns(['source_key', 'external_id']).doUpdateSet({
              last_seen_at: sql`now()`,
              gone_at: null,
              url: sql`excluded.url`,
              payload: sql`CASE WHEN raw_postings.content_hash <> excluded.content_hash THEN excluded.payload ELSE raw_postings.payload END`,
              status: sql`CASE WHEN raw_postings.content_hash <> excluded.content_hash AND raw_postings.status NOT IN ('rejected') THEN 'new'::raw_status ELSE raw_postings.status END`,
              attempts: sql`CASE WHEN raw_postings.content_hash <> excluded.content_hash THEN 0 ELSE raw_postings.attempts END`,
              content_hash: sql`excluded.content_hash`,
            }),
          )
          // xmax = 0 only for rows this statement inserted.
          .returning([sql<boolean>`(xmax = 0)`.as('inserted'), 'status'])
          .execute(),
      );
      for (const r of rows) {
        if (r.inserted) created++;
        else if (r.status === 'new') updated++;
      }
    }
    return { created, updated };
  }

  /** Postings missing from a complete listing have closed; so have jobs left with no live source. */
  private async markGone(unit: FetchUnit, startedAt: Date): Promise<number> {
    return this.db.asEngine(async (trx) => {
      const gone = await trx
        .updateTable('raw_postings')
        .set({ gone_at: sql`now()` })
        .where('source_key', '=', unit.sourceKey)
        .where((eb) => (unit.boardId ? eb('board_id', '=', unit.boardId) : eb('board_id', 'is', null)))
        .where('gone_at', 'is', null)
        .where('last_seen_at', '<', startedAt)
        .returning('job_id')
        .execute();
      const jobIds = [...new Set(gone.map((g) => g.job_id).filter((id): id is string => !!id))];
      if (!jobIds.length) return 0;
      const closed = await trx
        .updateTable('jobs')
        .set({ status: 'expired', closed_reason: 'gone_from_source' })
        .where('id', 'in', jobIds)
        .where('status', 'in', ['live', 'pending_review'])
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('job_sources as js')
                .innerJoin('raw_postings as r', 'r.id', 'js.raw_posting_id')
                .select('r.id')
                .whereRef('js.job_id', '=', 'jobs.id')
                .where('r.gone_at', 'is', null),
            ),
          ),
        )
        .execute();
      return Number(closed[0]?.numUpdatedRows ?? 0);
    });
  }

  private async finishRun(stats: RunStats, unit: FetchUnit, error: string | null) {
    await this.db.asEngine(async (trx) => {
      await trx
        .updateTable('source_runs')
        .set({
          finished_at: sql`now()`,
          ok: stats.ok || !!stats.skipped,
          fetched: stats.fetched,
          created: stats.created,
          updated: stats.updated,
          closed: stats.closed,
          error,
        })
        .where('id', '=', stats.runId)
        .execute();
      if (unit.boardId) {
        await trx
          .updateTable('source_boards')
          .set({
            last_fetched_at: sql`now()`,
            last_status: stats.ok ? `ok: ${stats.fetched} jobs` : (error ?? 'failed').slice(0, 200),
            consecutive_failures: stats.ok ? 0 : sql`consecutive_failures + 1`,
            // A board that keeps failing (closed, renamed, wrong token) switches itself off.
            enabled: stats.ok ? true : sql`consecutive_failures + 1 < ${BOARD_FAILURES_BEFORE_OFF}`,
          })
          .where('id', '=', unit.boardId)
          .execute();
      }
    });
  }
}

function lockKey(u: FetchUnit) {
  return `ingest:queued:${u.sourceKey}:${u.boardId ?? '-'}`;
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { sql } from 'kysely';
import { randomToken, sha256Hex } from '../common/crypto';
import { Problem } from '../common/problem';
import { assertPublicHttpsUrl, Resolver, resolvesPublic } from '../common/safe-url';
import { SecretBox } from '../common/secretbox';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

export const EVENT_TYPES = ['application.status_changed', 'match.created', 'work.ready', 'membership.updated'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const MAX_ENDPOINTS = 5;
const STRONG_MATCH = 80;
const RETRY_FOR_MS = 24 * 3600_000;
const TIMEOUT_MS = 10_000;
const BATCH = 500;

/** A stable id for an event, so re-running the outbox never sends it twice. */
export function eventId(type: string, key: string): string {
  const h = createHash('sha256').update(`${type}|${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` — what partners check on every delivery. */
export function signature(secret: string, body: string, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}

/** Wait after the nth failed try: 30s, 1m, 2m … up to 2 hours, for 24 hours in all. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 2 * 3600_000);
}

interface Cursor { at: string; id: string }

/** Partner webhooks: endpoints, the outbox that turns changes into events, and delivery with retries. */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');
  private readonly box: SecretBox;
  /** Swapped in tests. */
  fetchFn: typeof fetch = fetch;
  resolve?: Resolver;

  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY);
  }

  // ---------------------------------------------------------------- endpoints (partner API)

  async list(siteId: string) {
    const rows = await this.db.forSite(siteId, (trx) => trx.selectFrom('webhook_endpoints').select(['id', 'url', 'events', 'enabled', 'created_at']).where('site_id', '=', siteId).orderBy('created_at').execute());
    return rows.map(endpointView);
  }

  async create(siteId: string, input: { url: string; events: EventType[] }) {
    const url = assertPublicHttpsUrl(input.url).toString();
    const secret = `whsec_${randomToken(24)}`;
    const row = await this.db.forSite(siteId, async (trx) => {
      const count = await trx.selectFrom('webhook_endpoints').select(sql<number>`count(*)::int`.as('n')).where('site_id', '=', siteId).executeTakeFirstOrThrow();
      if (count.n >= MAX_ENDPOINTS) throw Problem.conflict('too_many_endpoints', `A site can have up to ${MAX_ENDPOINTS} webhook endpoints. Delete one first.`);
      return trx.insertInto('webhook_endpoints')
        .values({ site_id: siteId, url, events: [...new Set(input.events)], secret_hash: sha256Hex(secret), secret_ciphertext: this.box.seal(secret) })
        .returning(['id', 'url', 'events', 'enabled', 'created_at']).executeTakeFirstOrThrow();
    });
    return { ...endpointView(row), secret };
  }

  async remove(siteId: string, endpointId: string) {
    // Pending deliveries go with it (ON DELETE CASCADE).
    const r = await this.db.forSite(siteId, (trx) => trx.deleteFrom('webhook_endpoints').where('id', '=', endpointId).where('site_id', '=', siteId).returning('id').executeTakeFirst());
    if (!r) throw Problem.notFound('endpoint_not_found', 'There is no webhook endpoint here');
  }

  // ---------------------------------------------------------------- outbox

  /** Turn recent changes into deliveries for subscribed partner sites. Worker, every minute. */
  async collect(): Promise<Record<EventType, number>> {
    const out = { 'application.status_changed': 0, 'match.created': 0, 'work.ready': 0, 'membership.updated': 0 } as Record<EventType, number>;
    const any = await this.db.asEngine((trx) => trx.selectFrom('webhook_endpoints').select('id').where('enabled', '=', true).limit(1).executeTakeFirst());
    if (!any) {
      // Nobody listens: move the cursors forward so turning webhooks on later doesn't replay history.
      for (const t of EVENT_TYPES) await this.redis.client.del(`webhooks:cursor:${t}`);
      return out;
    }

    out['application.status_changed'] = await this.source('application.status_changed', async (c) => {
      const rows = await this.db.asEngine((trx) => sql<{ at: Date; at_text: string; key: string; user_id: string; site_id: string; application_id: string; job_id: string; to_status: string; from_status: string | null }>`
        SELECT e.at, e.at::text AS at_text, e.id::text AS key, a.user_id, a.site_id, a.id AS application_id, a.job_id, e.to_status, e.from_status
          FROM application_events e JOIN applications a ON a.id = e.application_id
         WHERE (e.at, e.id::text) > (${c.at}::timestamptz, ${c.id}) AND e.at < now() - interval '2 seconds'
         ORDER BY e.at, e.id::text LIMIT ${BATCH}`.execute(trx));
      return rows.rows.map((r) => ({ at: r.at, cursorAt: r.at_text, cursorId: r.key, key: r.key, userId: r.user_id, data: { application_id: r.application_id, job_id: r.job_id, status: r.to_status, previous_status: r.from_status } }));
    });

    out['match.created'] = await this.source('match.created', async (c) => {
      const rows = await this.db.asEngine((trx) => sql<{ at: Date; at_text: string; key: string; user_id: string; job_id: string; score: number }>`
        SELECT m.computed_at AS at, m.computed_at::text AS at_text, m.user_id::text || ':' || m.job_id::text AS key, m.user_id, m.job_id, m.score
          FROM matches m
         WHERE (m.computed_at, m.user_id::text || ':' || m.job_id::text) > (${c.at}::timestamptz, ${c.id})
           AND m.computed_at < now() - interval '2 seconds' AND m.score >= ${STRONG_MATCH} AND m.status = 'new'
         ORDER BY 1, 3 LIMIT ${BATCH}`.execute(trx));
      // Keyed by member and job, so a recomputed match isn't announced again.
      return rows.rows.map((r) => ({ at: r.at, cursorAt: r.at_text, cursorId: r.key, key: r.key, userId: r.user_id, data: { job_id: r.job_id, score: r.score } }));
    });

    out['work.ready'] = await this.source('work.ready', async (c) => {
      const rows = await this.db.asEngine((trx) => sql<{ at: Date; at_text: string; key: string; user_id: string; site_id: string; kind: string; status: string; subject_id: string | null }>`
        SELECT w.updated_at AS at, w.updated_at::text AS at_text, w.id::text AS key, w.user_id, w.site_id, w.kind, w.status, w.subject_id
          FROM work_items w
         WHERE (w.updated_at, w.id::text) > (${c.at}::timestamptz, ${c.id}) AND w.updated_at < now() - interval '2 seconds'
           AND w.status IN ('done', 'failed') AND w.user_id IS NOT NULL AND w.site_id IS NOT NULL
         ORDER BY 1, 3 LIMIT ${BATCH}`.execute(trx));
      // Only to the site that asked for the work.
      return rows.rows.map((r) => ({ at: r.at, cursorAt: r.at_text, cursorId: r.key, key: `${r.key}:${r.status}`, userId: r.user_id, onlySite: r.site_id, data: { work_id: r.key, kind: r.kind, status: r.status, subject_id: r.subject_id } }));
    });

    out['membership.updated'] = await this.source('membership.updated', async (c) => {
      const rows = await this.db.asEngine((trx) => sql<{ at: Date; at_text: string; key: string; user_id: string; community_id: string; status: string; current_period_end: Date | null }>`
        SELECT m.updated_at AS at, m.updated_at::text AS at_text, m.id::text AS key, m.user_id, m.community_id, m.status, m.current_period_end
          FROM memberships m
         WHERE (m.updated_at, m.id::text) > (${c.at}::timestamptz, ${c.id}) AND m.updated_at < now() - interval '2 seconds'
         ORDER BY 1, 3 LIMIT ${BATCH}`.execute(trx));
      return rows.rows.map((r) => ({
        at: r.at, cursorAt: r.at_text, cursorId: r.key, key: `${r.key}:${r.at_text}`, userId: r.user_id,
        data: { membership_id: r.key, community_id: r.community_id, status: r.status, current_period_end: r.current_period_end ? new Date(r.current_period_end).toISOString() : null },
      }));
    });
    return out;
  }

  private async source(type: EventType, read: (c: Cursor) => Promise<{ at: Date; cursorAt: string; cursorId: string; key: string; userId: string; onlySite?: string; data: object }[]>) {
    const cursorKey = `webhooks:cursor:${type}`;
    const saved = await this.redis.client.get(cursorKey);
    const cursor: Cursor = saved ? JSON.parse(saved) : { at: new Date(Date.now() - 60_000).toISOString(), id: '' };
    const events = await read(cursor);
    let queued = 0;
    for (const e of events) {
      const id = eventId(type, e.key);
      const createdAt = new Date(e.at).toISOString();
      const r = await this.db.asEngine((trx) => sql`
        INSERT INTO webhook_deliveries (endpoint_id, event, event_id, payload)
        SELECT ep.id, ${type}, ${id}::uuid,
               jsonb_build_object('id', ${id}::text, 'type', ${type}::text, 'created_at', ${createdAt}::text, 'site_user', sa.external_user_id, 'data', ${JSON.stringify(e.data)}::jsonb)
          FROM webhook_endpoints ep
          JOIN site_accounts sa ON sa.site_id = ep.site_id AND sa.user_id = ${e.userId}
         WHERE ep.enabled AND ${type} = ANY(ep.events) ${e.onlySite ? sql`AND ep.site_id = ${e.onlySite}` : sql``}
        ON CONFLICT (endpoint_id, event_id) DO NOTHING`.execute(trx));
      queued += Number(r.numAffectedRows ?? 0);
    }
    if (events.length) {
      const last = events[events.length - 1];
      await this.redis.client.set(cursorKey, JSON.stringify({ at: last.cursorAt, id: last.cursorId }));
    } else if (!saved) {
      await this.redis.client.set(cursorKey, JSON.stringify(cursor));
    }
    return queued;
  }

  // ---------------------------------------------------------------- delivery

  /** Send what's due. Worker, every minute. */
  async deliver(limit = 100): Promise<{ delivered: number; retrying: number; failed: number }> {
    const due = await this.db.asEngine((trx) =>
      trx.selectFrom('webhook_deliveries as d').innerJoin('webhook_endpoints as e', 'e.id', 'd.endpoint_id')
        .select(['d.id', 'd.payload', 'd.attempts', 'd.created_at', 'e.url', 'e.secret_ciphertext', 'e.enabled'])
        .where('d.status', '=', 'pending').where('d.next_attempt_at', '<=', sql<Date>`now()`)
        .orderBy('d.next_attempt_at').limit(limit).execute(),
    );
    const tally = { delivered: 0, retrying: 0, failed: 0 };
    for (const d of due) {
      if (!d.enabled || !d.secret_ciphertext) {
        await this.finish(d.id, 'failed', 'endpoint_removed');
        tally.failed++;
        continue;
      }
      const error = await this.post(d.url, this.box.open(d.secret_ciphertext), JSON.stringify(d.payload));
      if (!error) {
        await this.db.asEngine((trx) => trx.updateTable('webhook_deliveries').set({ status: 'delivered', delivered_at: sql`now()`, attempts: d.attempts + 1, last_error: null }).where('id', '=', d.id).execute());
        tally.delivered++;
        continue;
      }
      const attempts = d.attempts + 1;
      const next = Date.now() + retryDelayMs(attempts);
      if (next - new Date(d.created_at as unknown as string).getTime() > RETRY_FOR_MS) {
        await this.finish(d.id, 'failed', error, attempts);
        tally.failed++;
      } else {
        await this.db.asEngine((trx) => trx.updateTable('webhook_deliveries').set({ attempts, last_error: error.slice(0, 300), next_attempt_at: new Date(next) }).where('id', '=', d.id).execute());
        tally.retrying++;
      }
    }
    if (tally.failed) this.logger.warn(`${tally.failed} webhook deliveries gave up after 24 hours`);
    return tally;
  }

  private async finish(id: string, status: 'failed', error: string, attempts?: number) {
    await this.db.asEngine((trx) => trx.updateTable('webhook_deliveries').set({ status, last_error: error.slice(0, 300), ...(attempts ? { attempts } : {}) }).where('id', '=', id).execute());
  }

  /** Returns null on a 2xx, or why it failed. */
  private async post(url: string, secret: string, body: string): Promise<string | null> {
    const u = new URL(url);
    if (!(await resolvesPublic(u.hostname, this.resolve))) return 'address_not_public';
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'user-agent': 'i-jobs-webhooks/1', 'x-ijobs-signature': signature(secret, body) },
      });
      await res.body?.cancel().catch(() => undefined);
      return res.status >= 200 && res.status < 300 ? null : `http_${res.status}`;
    } catch (e) {
      return (e as Error).name === 'TimeoutError' ? 'timeout' : `network:${(e as Error).message}`.slice(0, 200);
    }
  }
}

function endpointView(r: { id: string; url: string; events: string[]; enabled: boolean; created_at: unknown }) {
  return { id: r.id, url: r.url, events: r.events, enabled: r.enabled, created_at: new Date(r.created_at as string).toISOString() };
}

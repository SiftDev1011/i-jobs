import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { Http } from './http';

/** Signs on a page that the job has closed even though the page itself loads. */
const CLOSED_TEXT = /\b(this (job|position|role|posting) (is no longer|has been) (available|filled|closed)|no longer accepting applications|job (has )?expired|position (has been )?filled|the job you are looking for (is no longer|could not be))\b/i;

/**
 * Keeps live jobs honest: closes them at expiry, and checks apply links on sources that
 * don't give us a complete listing. Never checks aggregator links: those count as clicks.
 */
@Injectable()
export class UpkeepService {
  private readonly logger = new Logger('Upkeep');

  constructor(
    private readonly db: Db,
    private readonly http: Http,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async expire(): Promise<number> {
    const r = await this.db.asEngine((trx) =>
      trx
        .updateTable('jobs')
        .set({ status: 'expired', closed_reason: 'expired' })
        .where('status', 'in', ['live', 'pending_review'])
        .where('expires_at', '<', sql<Date>`now()`)
        .execute(),
    );
    return Number(r[0]?.numUpdatedRows ?? 0);
  }

  async checkLinks(limit = this.config.LINK_CHECKS_PER_RUN): Promise<{ checked: number; dead: number; closed: number }> {
    const jobs = await this.db.asEngine((trx) =>
      trx
        .selectFrom('jobs as j')
        .innerJoin('sources as s', 's.key', 'j.primary_source_key')
        .select(['j.id', 'j.apply_url', 'j.link_failures'])
        .where('j.status', '=', 'live')
        .where('j.apply_url', 'is not', null)
        .where('s.kind', 'not in', ['ats_feed', 'aggregator', 'employer_post', 'platform_post'])
        .where(({ not, exists, selectFrom }) =>
          not(exists(selectFrom('job_link_checks as c').select('c.id').whereRef('c.job_id', '=', 'j.id').where('c.checked_at', '>', sql<Date>`now() - interval '3 days'`))),
        )
        .orderBy('j.first_seen_at')
        .limit(limit)
        .execute(),
    );

    let dead = 0;
    let closed = 0;
    for (const job of jobs) {
      const { alive, status, note } = await this.probe(job.apply_url!);
      if (!alive) dead++;
      await this.db.asEngine(async (trx) => {
        await trx.insertInto('job_link_checks').values({ job_id: job.id, http_status: status, alive, note }).execute();
        // Two failed checks in a row (days apart) before closing: sites have bad days.
        const failures = alive ? 0 : job.link_failures + 1;
        const close = !alive && failures >= 2;
        if (close) closed++;
        await trx
          .updateTable('jobs')
          .set({ link_failures: failures, ...(close ? { status: 'expired' as const, closed_reason: 'link_dead' } : {}) })
          .where('id', '=', job.id)
          .execute();
      });
    }
    if (jobs.length) this.logger.log(`Link checks: ${jobs.length} checked, ${dead} dead, ${closed} closed`);
    return { checked: jobs.length, dead, closed };
  }

  /** GET, not HEAD: many job sites answer HEAD wrongly. Network errors count as alive (we can't tell). */
  async probe(url: string): Promise<{ alive: boolean; status: number | null; note: string | null }> {
    try {
      const res = await this.http.request(url, { retries: 1, timeoutMs: 15_000, headers: { Accept: 'text/html,*/*;q=0.5' } });
      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel().catch(() => undefined);
        return { alive: false, status: res.status, note: 'gone' };
      }
      if (res.status >= 400) {
        await res.body?.cancel().catch(() => undefined);
        return { alive: true, status: res.status, note: 'blocked_or_error' };
      }
      const text = (await res.text()).slice(0, 200_000);
      if (CLOSED_TEXT.test(text)) return { alive: false, status: res.status, note: 'page_says_closed' };
      return { alive: true, status: res.status, note: null };
    } catch (e) {
      return { alive: true, status: null, note: `unreachable: ${(e as Error).message.slice(0, 120)}` };
    }
  }
}

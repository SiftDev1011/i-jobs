import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { regionsOf } from '../ingest/places';
import { CONFIRM_EVERY_DAYS } from '../profile/profile.service';
import { RelayService } from './relay.service';

/** Matches this good go to the apply queue when autopilot won't send them. */
export const QUEUE_MIN_SCORE = 60;
const STAGGER_MINUTES = 7;

type QueueReason = 'unverified_employer' | 'apply_on_source_site' | 'outside_rules' | 'autopilot_off' | 'job_cap_reached';

/**
 * Decides, for each good match, whether autopilot sends it or it waits in the member's apply queue.
 * Autopilot only ever sends to verified or careers-page employers by email (or on our platform), from
 * sources that allow it, inside the member's own rules and daily cap.
 */
@Injectable()
export class PlannerService {
  private readonly logger = new Logger('Planner');

  constructor(
    private readonly db: Db,
    private readonly relay: RelayService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Members with autopilot on, or with fresh matches to sort into their queue. */
  async planDue(limit = 500): Promise<{ members: number; scheduled: number; queued: number }> {
    const users = await this.db.asEngine((trx) =>
      sql<{ user_id: string }>`
        SELECT user_id FROM autopilot_rules WHERE enabled
        UNION
        SELECT DISTINCT user_id FROM matches WHERE status IN ('new', 'seen', 'saved') AND score >= ${QUEUE_MIN_SCORE} AND computed_at > now() - interval '1 day'
        LIMIT ${limit}`.execute(trx),
    );
    let scheduled = 0;
    let queued = 0;
    for (const { user_id } of users.rows) {
      const r = await this.planMember(user_id);
      scheduled += r.scheduled;
      queued += r.queued;
    }
    return { members: users.rows.length, scheduled, queued };
  }

  async planMember(userId: string): Promise<{ scheduled: number; queued: number }> {
    const ctx = await this.memberContext(userId);
    const candidates = await this.db.asEngine((trx) =>
      sql<any>`
        SELECT m.job_id, m.score, m.status, mj.autopilot_ok, mj.trust, mj.apply_method, mj.apply_email, mj.location_scope,
               mj.allowed_countries, mj.allowed_regions, mj.employment_type, mj.salary_min_minor, mj.salary_max_minor,
               mj.salary_currency, mj.salary_period, mj.autopilot_sent, mj.autopilot_cap, s.apply_via_source_link, s.allow_autopilot
          FROM matches m
          JOIN matchable_jobs mj ON mj.id = m.job_id
          JOIN sources s ON s.key = mj.primary_source_key
         WHERE m.user_id = ${userId}
           AND m.status IN ('new', 'seen', 'saved', 'in_queue')
           AND m.score >= ${QUEUE_MIN_SCORE}
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = m.user_id AND a.job_id = m.job_id)
         ORDER BY m.score DESC
         LIMIT 200`.execute(trx),
    );

    let room = ctx.autopilot ? Math.max(0, ctx.dailyCap - ctx.usedToday) : 0;
    let scheduled = 0;
    let queued = 0;
    for (const c of candidates.rows) {
      const reason = this.whyNotAutopilot(ctx, c);
      if (!reason && c.score >= ctx.minMatch) {
        if (room <= 0) continue; // today's cap is used: tomorrow's run picks it up
        await this.schedule(userId, ctx, c, scheduled);
        room--;
        scheduled++;
      } else {
        const why: QueueReason = reason ?? 'outside_rules';
        if (c.status !== 'in_queue') {
          await this.db.asEngine((trx) =>
            trx.updateTable('matches').set({ status: 'in_queue', queue_reason: why }).where('user_id', '=', userId).where('job_id', '=', c.job_id).where('status', '!=', 'dismissed').execute(),
          );
          queued++;
        }
      }
    }
    return { scheduled, queued };
  }

  private whyNotAutopilot(ctx: MemberContext, c: any): QueueReason | null {
    if (c.apply_via_source_link) return 'apply_on_source_site';
    if (c.trust === 'unverified') return 'unverified_employer';
    if (!ctx.autopilot) return 'autopilot_off';
    if (c.autopilot_sent >= c.autopilot_cap) return 'job_cap_reached';
    // Autopilot sends by email today; employer platform posts and ATS hand-offs come with employer features.
    if (!c.autopilot_ok || c.apply_method !== 'email' || !c.apply_email) return 'outside_rules';
    if (!this.inRules(ctx, c)) return 'outside_rules';
    return null;
  }

  private inRules(ctx: MemberContext, c: any): boolean {
    const regions = ctx.regions;
    const scopeOk =
      (c.location_scope === 'worldwide' && regions.includes('worldwide')) ||
      (c.location_scope === 'unspecified' && ctx.includeUnspecified) ||
      (c.location_scope === 'restricted' &&
        (regions.includes('worldwide') ||
          (c.allowed_countries ?? []).some((x: string) => regions.includes(x.trim().toUpperCase())) ||
          (c.allowed_regions ?? []).some((x: string) => regions.includes(x)) ||
          (c.allowed_countries ?? []).some((x: string) => regionsOf(x.trim()).some((r) => regions.includes(r)))));
    if (!scopeOk) return false;
    if (ctx.employmentTypes.length && !ctx.employmentTypes.includes(c.employment_type)) return false;
    if (ctx.minPayMonthly && c.salary_currency === ctx.payCurrency) {
      const top = Number(c.salary_max_minor ?? c.salary_min_minor ?? 0);
      const monthly = ({ hour: top * 160, day: top * 22, week: (top * 52) / 12, month: top, year: top / 12 } as Record<string, number>)[c.salary_period] ?? null;
      if (monthly !== null && monthly < ctx.minPayMonthly) return false;
    }
    return true;
  }

  private async schedule(userId: string, ctx: MemberContext, c: any, nth: number) {
    const relay = await this.relay.ensure(userId);
    const at = new Date(Date.now() + this.config.AUTOPILOT_CANCEL_HOURS * 3600_000 + nth * STAGGER_MINUTES * 60_000);
    await this.db.asEngine(async (trx) => {
      const inserted = await trx
        .insertInto('applications')
        .values({
          user_id: userId, job_id: c.job_id, site_id: ctx.siteId, mode: 'autopilot', channel: 'email_relay', status: 'scheduled',
          match_score: c.score, scheduled_for: at, cancel_until: at, relay_address_id: relay.id,
          employer_key: String(c.apply_email).split('@')[1]?.toLowerCase() ?? null,
        })
        .onConflict((oc) => oc.constraint('applications_once_per_job').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) await trx.updateTable('matches').set({ status: 'applied', queue_reason: null }).where('user_id', '=', userId).where('job_id', '=', c.job_id).execute();
    });
  }

  private async memberContext(userId: string): Promise<MemberContext> {
    const row = await this.db.asEngine((trx) =>
      trx
        .selectFrom('users as u')
        .leftJoin('autopilot_rules as r', 'r.user_id', 'u.id')
        .leftJoin('profiles as p', 'p.user_id', 'u.id')
        .select([
          'u.status', 'u.full_name', 'u.age_band', 'u.bounces_30d', 'r.enabled', 'r.min_match', 'r.regions', 'r.include_unspecified',
          'r.employment_types', 'r.daily_cap', 'r.paused_until', 'r.min_pay_monthly_minor', 'r.pay_currency', 'p.confirmed_at', 'p.cv_file_key',
        ])
        .where('u.id', '=', userId)
        .executeTakeFirstOrThrow(),
    );
    const consent = await this.db.k.selectFrom('current_consents').select('granted').where('user_id', '=', userId).where('purpose', '=', 'autopilot').executeTakeFirst();
    const siteId = await this.homeSite(userId);
    const confirmed = row.confirmed_at ? new Date(row.confirmed_at as unknown as string).getTime() : 0;
    const autopilot =
      !!row.enabled && consent?.granted === true && row.status === 'active' && row.age_band === 'adult' && !!row.full_name && !!row.cv_file_key &&
      Date.now() - confirmed <= CONFIRM_EVERY_DAYS * 86400_000 && (!row.paused_until || new Date(row.paused_until as unknown as string) < new Date()) &&
      row.bounces_30d < 5 && !!siteId;
    const usedToday = autopilot
      ? Number((await this.db.asEngine((trx) =>
          sql<{ n: number }>`SELECT count(*)::int AS n FROM applications WHERE user_id = ${userId} AND mode = 'autopilot'
                               AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.execute(trx))).rows[0].n)
      : 0;
    const types = row.employment_types as unknown;
    return {
      autopilot,
      siteId: siteId ?? '',
      minMatch: row.min_match ?? 80,
      regions: ((row.regions ?? ['worldwide']) as string[]).map((r) => (r.length === 2 ? r.toUpperCase() : r)),
      includeUnspecified: !!row.include_unspecified,
      employmentTypes: Array.isArray(types) ? types : typeof types === 'string' ? types.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : [],
      dailyCap: row.daily_cap ?? 5,
      usedToday,
      minPayMonthly: row.min_pay_monthly_minor ? Number(row.min_pay_monthly_minor) : null,
      payCurrency: row.pay_currency,
    };
  }

  /** The site autopilot applications belong to: i-jobs with an active membership, else a partner site the member uses. */
  private async homeSite(userId: string): Promise<string | null> {
    const membership = await this.db.asEngine((trx) =>
      trx
        .selectFrom('sites')
        .select('id')
        .where('slug', '=', this.config.IJOBS_SITE_SLUG)
        .where(({ exists, selectFrom }) =>
          exists(selectFrom('memberships').select('id').where('user_id', '=', userId).where('status', 'in', ['active', 'trialing'])),
        )
        .executeTakeFirst(),
    );
    if (membership) return membership.id;
    const partner = await this.db.asEngine((trx) =>
      trx.selectFrom('site_accounts as a').innerJoin('sites as s', 's.id', 'a.site_id').select('s.id').where('a.user_id', '=', userId).where('s.requires_community', '=', false).orderBy('a.linked_at').executeTakeFirst(),
    );
    return partner?.id ?? null;
  }
}

interface MemberContext {
  autopilot: boolean;
  siteId: string;
  minMatch: number;
  regions: string[];
  includeUnspecified: boolean;
  employmentTypes: string[];
  dailyCap: number;
  usedToday: number;
  minPayMonthly: number | null;
  payCurrency: string | null;
}

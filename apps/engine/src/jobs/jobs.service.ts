import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Kysely, sql } from 'kysely';
import { DB } from '../db/schema';
import { decodeCursor, page } from '../common/cursor';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { textHash } from '../ingest/scam';

export interface JobSearch {
  q?: string;
  location?: ('worldwide' | 'unspecified' | 'restricted')[];
  employment_type?: string[];
  min_pay_monthly?: number;
  currency: string;
  verified_only: boolean;
  category?: string;
  cursor?: string;
  limit: number;
}

const REPORTS_TO_HIDE = 3;

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());

/** Monthly equivalent of a pay figure, for "at least X a month" filters. */
const monthly = (col: string) => sql<number>`CASE j.salary_period
  WHEN 'hour' THEN ${sql.ref(col)} * 160 WHEN 'day' THEN ${sql.ref(col)} * 22 WHEN 'week' THEN ${sql.ref(col)} * 52 / 12
  WHEN 'month' THEN ${sql.ref(col)} WHEN 'year' THEN ${sql.ref(col)} / 12 ELSE NULL END`;

@Injectable()
export class JobsService {
  constructor(private readonly db: Db) {}

  /** Live-job query with its primary source joined. Used by search, job finds and match lists. */
  base(opts: { visibleOnly?: boolean; k?: Kysely<DB> } = {}) {
    const q = (opts.k ?? this.db.k)
      .selectFrom('jobs as j')
      .innerJoin('job_sources as js', (join) => join.onRef('js.job_id', '=', 'j.id').on('js.is_primary', '=', true))
      .innerJoin('sources as s', 's.key', 'js.source_key')
      .select([
        'j.id', 'j.title', 'j.company_name', 'j.location_scope', 'j.allowed_countries', 'j.allowed_regions', 'j.employment_type',
        'j.salary_min_minor', 'j.salary_max_minor', 'j.salary_currency', 'j.salary_period', 'j.trust', 'j.first_seen_at',
        'j.original_posted_at', 'j.deadline_at', 'j.expires_at', 'j.seniority', 'j.apply_method', 'j.apply_url', 'j.apply_email',
        'j.autopilot_sent', 'j.autopilot_cap', 's.key as source_key', 's.credit_text', 's.requires_credit', 's.allow_autopilot',
        's.apply_via_source_link', 'js.source_url', 'js.apply_url as source_apply_url',
      ]);
    // Applications and other history show their job even after its source is switched off.
    if (opts.visibleOnly === false) return q;
    return q.where('s.enabled', '=', true).where(sql<boolean>`j.first_seen_at <= now() - make_interval(hours => s.publish_delay_hours)`);
  }

  async search(f: JobSearch) {
    const after = decodeCursor(f.cursor);
    let q = this.base().where('j.status', '=', 'live').where('s.display', '=', 'full');
    if (f.q?.trim()) q = q.where(sql<boolean>`j.search @@ websearch_to_tsquery('english', ${f.q.trim()})`);
    if (f.location?.length) q = q.where('j.location_scope', 'in', f.location);
    if (f.employment_type?.length) q = q.where('j.employment_type', 'in', f.employment_type as never[]);
    if (f.category) q = q.where('j.category', '=', f.category);
    if (f.verified_only) q = q.where('j.trust', 'in', ['verified_employer', 'careers_page']);
    if (f.min_pay_monthly) {
      q = q
        .where('j.salary_currency', '=', f.currency.toUpperCase())
        .where(sql<boolean>`coalesce(${monthly('j.salary_max_minor')}, ${monthly('j.salary_min_minor')}) >= ${f.min_pay_monthly}`);
    }
    if (after) {
      q = q.where((eb: ExpressionBuilder<any, any>) =>
        eb.or([eb('j.first_seen_at', '<', after.at), eb.and([eb('j.first_seen_at', '=', after.at), eb('j.id', '<', after.id)])]),
      );
    }
    const rows = await q.orderBy('j.first_seen_at', 'desc').orderBy('j.id', 'desc').limit(f.limit + 1).execute();
    const p = page(rows, f.limit, (r) => ({ at: new Date(r.first_seen_at as unknown as string).toISOString(), id: r.id }));
    return { items: p.items.map((r) => this.summary(r)), next_cursor: p.next_cursor };
  }

  /** `anyStatus` is for the poster, who sees their job while it's under review. */
  async get(id: string, opts: { anyStatus?: boolean } = {}) {
    const row = await this.base(opts.anyStatus ? { visibleOnly: false } : {})
      .leftJoin('communities as c', 'c.id', 'j.community_id')
      .select(['j.status', 'j.description', 'j.summary', 'j.skills', 'j.tz_min_offset_hours', 'j.tz_max_offset_hours', 'c.name as community_name', 's.display'])
      .where('j.id', '=', id)
      .executeTakeFirst();
    if (!row || (!opts.anyStatus && (row.status === 'pending_review' || row.display === 'disabled'))) throw Problem.notFound('job_not_found', 'There is no job here');
    if (!opts.anyStatus && row.status !== 'live') throw new Problem(410, 'job_closed', 'This job has closed');
    return {
      ...this.summary(row),
      description: row.description,
      summary: row.summary,
      skills: row.skills,
      timezone_hours: { min_offset: row.tz_min_offset_hours, max_offset: row.tz_max_offset_hours },
      seniority: row.seniority,
      community: row.community_name ? { name: row.community_name } : null,
      ...(opts.anyStatus ? { status: row.status } : {}),
    };
  }

  /** The shareable job finds page: newest jobs, including sources that only allow free display. */
  async jobFinds(ref: string | undefined, cursor: string | undefined, limit: number) {
    const after = decodeCursor(cursor);
    let q = this.base().where('j.status', '=', 'live').where('s.display', 'in', ['full', 'job_finds_only']);
    if (after) {
      q = q.where((eb: ExpressionBuilder<any, any>) =>
        eb.or([eb('j.first_seen_at', '<', after.at), eb.and([eb('j.first_seen_at', '=', after.at), eb('j.id', '<', after.id)])]),
      );
    }
    const [rows, community] = await Promise.all([
      q.orderBy('j.first_seen_at', 'desc').orderBy('j.id', 'desc').limit(limit + 1).execute(),
      ref
        ? this.db.k.selectFrom('communities').select(['name', 'slug']).where('invite_code', '=', ref).where('status', '=', 'active').executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    const p = page(rows, limit, (r) => ({ at: new Date(r.first_seen_at as unknown as string).toISOString(), id: r.id }));
    return { community: community ? { name: community.name, slug: community.slug } : null, items: p.items.map((r) => this.summary(r)), next_cursor: p.next_cursor };
  }

  async report(jobId: string, userId: string, reason: string, details?: string) {
    await this.db.asEngine(async (trx) => {
      const job = await trx.selectFrom('jobs').select(['id', 'status', 'trust', 'report_count']).where('id', '=', jobId).forUpdate().executeTakeFirst();
      if (!job || job.status !== 'live') throw Problem.notFound('job_not_found', 'There is no live job here');
      const inserted = await trx
        .insertInto('job_reports')
        .values({ job_id: jobId, reporter_id: userId, reason, details: details ?? null })
        .onConflict((oc) => oc.columns(['job_id', 'reporter_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) throw Problem.conflict('already_reported', 'You have already reported this job');
      const count = job.report_count + 1;
      // Several reports hide an unverified job until a moderator looks. Employer listings stay up.
      const hide = count >= REPORTS_TO_HIDE && job.trust === 'unverified';
      await trx.updateTable('jobs').set({ report_count: count, ...(hide ? { status: 'pending_review' as const } : {}) }).where('id', '=', jobId).execute();
      if (count >= REPORTS_TO_HIDE) {
        const open = await trx.selectFrom('moderation_items').select('id').where('subject_type', '=', 'job').where('subject_id', '=', jobId).where('status', 'in', ['open', 'in_review', 'escalated']).executeTakeFirst();
        if (!open) {
          await trx.insertInto('moderation_items').values({ subject_type: 'job', subject_id: jobId, reason_internal: `${count} member reports (latest: ${reason})` }).execute();
        }
      }
    });
  }

  async takedown(jobId: string, staffUserId: string, reason: string) {
    await this.db.asEngine(async (trx) => {
      const job = await trx.selectFrom('jobs').select(['id', 'description']).where('id', '=', jobId).executeTakeFirst();
      if (!job) throw Problem.notFound('job_not_found', 'There is no job here');
      await trx.updateTable('jobs').set({ status: reason === 'scam' ? 'scam' : 'removed', closed_reason: `takedown:${reason}` }).where('id', '=', jobId).execute();
      if (reason === 'scam') {
        // The same text is then caught at once wherever else it's posted.
        await trx
          .insertInto('scam_signatures')
          .values({ text_hash: textHash(job.description), example_job_id: jobId, confirmed_by: staffUserId })
          .onConflict((oc) => oc.column('text_hash').doNothing())
          .execute();
      }
      await trx.insertInto('audit_log').values({ actor_user_id: staffUserId, actor_kind: 'staff', action: 'job.takedown', subject_type: 'job', subject_id: jobId, meta: JSON.stringify({ reason }) }).execute();
    });
  }

  summary(r: any) {
    const now = Date.now();
    const firstSeen = new Date(r.first_seen_at).getTime();
    const closes = r.deadline_at ? new Date(r.deadline_at).getTime() : new Date(r.expires_at).getTime();
    const badges: string[] = [];
    if (now - firstSeen < 86400_000) badges.push('new_today');
    if (closes - now < 3 * 86400_000) badges.push('closes_soon');
    if (r.employment_type === 'internship') badges.push('internship');
    if (r.employment_type === 'graduate' || ['junior', 'intern'].includes(r.seniority)) badges.push('grad_friendly');
    if (['part_time', 'freelance'].includes(r.employment_type)) badges.push('side_gig');
    const viaSource = r.apply_via_source_link;
    return {
      id: r.id,
      title: r.title,
      company_name: r.company_name,
      location_scope: r.location_scope,
      allowed_countries: r.allowed_countries,
      allowed_regions: r.allowed_regions,
      employment_type: r.employment_type,
      pay: {
        min_minor: r.salary_min_minor === null ? null : Number(r.salary_min_minor),
        max_minor: r.salary_max_minor === null ? null : Number(r.salary_max_minor),
        currency: r.salary_currency,
        period: r.salary_period,
      },
      trust: r.trust,
      badges,
      first_seen_at: iso(r.first_seen_at),
      original_posted_at: iso(r.original_posted_at),
      deadline_at: iso(r.deadline_at),
      match_score: r.match_score ?? null,
      source: { key: r.source_key, credit: r.requires_credit ? r.credit_text : null, url: r.source_url },
      apply: {
        method: r.apply_method,
        // Sources whose terms say apply through their link get exactly that link.
        url: viaSource ? (r.source_apply_url ?? r.apply_url) : r.apply_method === 'email' ? null : r.apply_url,
        autopilot_eligible:
          !!r.allow_autopilot && !viaSource && ['verified_employer', 'careers_page'].includes(r.trust) &&
          ['on_platform', 'email', 'ats_api'].includes(r.apply_method) && r.autopilot_sent < r.autopilot_cap &&
          now - firstSeen < 14 * 86400_000,
      },
    };
  }
}


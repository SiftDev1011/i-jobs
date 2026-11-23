import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, sql } from 'kysely';
import { AccessService } from '../account/access.service';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { JobsService } from '../jobs/jobs.service';
import { regionsOf } from '../ingest/places';
import { CONFIRM_EVERY_DAYS } from './profile.service';

export interface AutopilotInput {
  enabled?: boolean;
  min_match?: number;
  min_pay_monthly?: { amount_minor: number; currency: string } | null;
  regions?: string[];
  include_unspecified?: boolean;
  employment_types?: string[];
  daily_cap?: number;
  paused_until?: string | null;
}

/** The member's match feed, and their autopilot rules. */
@Injectable()
export class MatchesService {
  constructor(
    private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string, siteId: string, f: { status?: string[]; min_score?: number; cursor?: string; limit: number }) {
    await this.access.assertJobFeatures(userId, siteId);
    const statuses = f.status?.length ? f.status : ['new', 'seen', 'saved'];
    const after = decodeScoreCursor(f.cursor);
    let q = this.jobs
      .base()
      .innerJoin('matches as m', (j) => j.onRef('m.job_id', '=', 'j.id').on('m.user_id', '=', userId))
      .select(['m.score as match_score', 'm.reasons', 'm.gaps', 'm.pathways', 'm.status as match_status'])
      .where('j.status', '=', 'live')
      .where('s.display', '=', 'full')
      .where('m.status', 'in', statuses as never[]);
    if (f.min_score) q = q.where('m.score', '>=', f.min_score);
    if (after) {
      q = q.where((eb: ExpressionBuilder<any, any>) => eb.or([eb('m.score', '<', after.score), eb.and([eb('m.score', '=', after.score), eb('j.id', '<', after.id)])]));
    }
    const rows = await q.orderBy('m.score', 'desc').orderBy('j.id', 'desc').limit(f.limit + 1).execute();
    const more = rows.length > f.limit;
    const items = rows.slice(0, f.limit);

    const trainingIds = [...new Set(items.flatMap((r: any) => (r.gaps as { training_id: string | null }[]).map((g) => g.training_id).filter(Boolean)))] as string[];
    const trainings = trainingIds.length
      ? await this.db.k.selectFrom('trainings').select(['id', 'external_id', 'title', 'url', 'skills', 'duration_minutes', 'is_free', 'suitable_for_minors']).where('id', 'in', trainingIds).execute()
      : [];
    const byId = new Map(trainings.map((t) => [t.id, { id: t.external_id, title: t.title, url: t.url, skills: t.skills, duration_minutes: t.duration_minutes, is_free: t.is_free, suitable_for_minors: t.suitable_for_minors }]));

    const last = items[items.length - 1] as any;
    return {
      items: items.map((r: any) => this.view(r, byId)),
      next_cursor: more ? Buffer.from(JSON.stringify({ score: last.match_score, id: last.id })).toString('base64url') : null,
    };
  }

  async setStatus(userId: string, siteId: string, jobId: string, status: 'seen' | 'saved' | 'dismissed') {
    await this.access.assertJobFeatures(userId, siteId);
    const r = await this.db.asEngine((trx) =>
      trx
        .updateTable('matches')
        .set({ status, ...(status === 'seen' ? { seen_at: sql`coalesce(seen_at, now())` } : {}) })
        .where('user_id', '=', userId)
        .where('job_id', '=', jobId)
        .where('status', 'not in', ['in_queue', 'applied'])
        .executeTakeFirst(),
    );
    if (!Number(r.numUpdatedRows)) throw Problem.notFound('match_not_found', 'This job is not in your matches');
    const row = await this.jobs
      .base()
      .innerJoin('matches as m', (j) => j.onRef('m.job_id', '=', 'j.id').on('m.user_id', '=', userId))
      .select(['m.score as match_score', 'm.reasons', 'm.gaps', 'm.pathways', 'm.status as match_status'])
      .where('j.id', '=', jobId)
      .executeTakeFirstOrThrow();
    return this.view(row, new Map());
  }

  // ---------------------------------------------------------------- autopilot rules

  async getRules(userId: string) {
    const r = await this.db.k.selectFrom('autopilot_rules').selectAll().where('user_id', '=', userId).executeTakeFirst();
    return rulesView(r ?? null);
  }

  async setRules(userId: string, siteId: string, input: AutopilotInput) {
    let consentId: string | null = null;
    if (input.enabled) {
      await this.access.assertJobFeatures(userId, siteId);
      await this.access.assertConsent(userId, 'autopilot');
      const p = await this.db.k.selectFrom('profiles').select('confirmed_at').where('user_id', '=', userId).executeTakeFirst();
      const confirmed = p?.confirmed_at ? new Date(p.confirmed_at as unknown as string).getTime() : 0;
      if (Date.now() - confirmed > CONFIRM_EVERY_DAYS * 86400_000) {
        throw Problem.forbidden('profile_not_confirmed', 'Check and confirm your profile first, so applications say the right things');
      }
      const consent = await this.db.k.selectFrom('consents').select('id').where('user_id', '=', userId).where('purpose', '=', 'autopilot').where('granted', '=', true).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
      consentId = consent.id;
    }
    const values: Record<string, unknown> = {};
    if (input.enabled !== undefined) values.enabled = input.enabled;
    if (consentId) values.consent_id = consentId;
    if (input.min_match !== undefined) values.min_match = input.min_match;
    if (input.min_pay_monthly !== undefined) {
      values.min_pay_monthly_minor = input.min_pay_monthly?.amount_minor ?? null;
      if (input.min_pay_monthly) values.pay_currency = input.min_pay_monthly.currency.toUpperCase();
    }
    if (input.regions !== undefined) values.regions = [...new Set(input.regions.map((r) => (r.length === 2 ? r.toUpperCase() : r.toLowerCase())))];
    if (input.include_unspecified !== undefined) values.include_unspecified = input.include_unspecified;
    if (input.employment_types !== undefined) values.employment_types = input.employment_types;
    if (input.daily_cap !== undefined) values.daily_cap = input.daily_cap;
    if (input.paused_until !== undefined) values.paused_until = input.paused_until;

    await this.db.asEngine((trx) =>
      trx
        .insertInto('autopilot_rules')
        .values({ user_id: userId, ...values })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
        .execute(),
    );
    return this.getRules(userId);
  }

  private view(r: any, trainings: Map<string, unknown>) {
    const job = this.jobs.summary(r);
    return {
      job,
      score: r.match_score,
      reasons: r.reasons ?? [],
      gaps: ((r.gaps ?? []) as { skill: string; training_id: string | null }[]).map((g) => ({ skill: g.skill, training: (g.training_id && trainings.get(g.training_id)) || null })),
      status: r.match_status,
      other_pathways: r.pathways ?? [],
    };
  }
}

export const RULE_REGIONS = ['worldwide', 'africa', 'emea', 'europe', 'latam', 'americas', 'north_america', 'apac', 'asia', 'middle_east', 'mena', 'oceania'];
export const isRuleRegion = (r: string) => RULE_REGIONS.includes(r.toLowerCase()) || (r.length === 2 && regionsOf(r).length > 0);

function rulesView(r: any) {
  return {
    enabled: r?.enabled ?? false,
    min_match: r?.min_match ?? 80,
    min_pay_monthly: r?.min_pay_monthly_minor === null || r?.min_pay_monthly_minor === undefined ? null : { amount_minor: Number(r.min_pay_monthly_minor), currency: r.pay_currency },
    regions: r?.regions ?? ['worldwide'],
    include_unspecified: r?.include_unspecified ?? false,
    // node-postgres doesn't know our enum's array type, so it can arrive as "{a,b}".
    employment_types: pgList(r?.employment_types),
    daily_cap: r?.daily_cap ?? 5,
    paused_until: r?.paused_until ? new Date(r.paused_until).toISOString() : null,
  };
}

function pgList(v: unknown): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  return [];
}

function decodeScoreCursor(c?: string): { score: number; id: string } | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (typeof v.score === 'number' && typeof v.id === 'string') return v;
  } catch {
    /* fall through */
  }
  throw Problem.badRequest('invalid_cursor', 'This page link is no longer valid. Start from the first page.');
}

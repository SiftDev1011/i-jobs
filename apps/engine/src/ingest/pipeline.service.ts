import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, Transaction } from 'kysely';
import { AiBadOutput, AiBudgetExhausted, AiRateLimited, AiService } from '../ai/ai.service';
import { JobExtract, jobExtractPrompt, ScamCheck, scamCheckPrompt } from '../ai/prompts';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { DB } from '../db/schema';
import { connectorFor } from './connectors';
import { tagLocation } from './location';
import { categorise, dedupeKey, employmentType, payFromNumbers, seniority } from './normalise';
import { SCAM_BLOCK, SCAM_REVIEW, screen, textHash } from './scam';
import { firstWords, hostOf, oneLine, safeUrl, truncate } from './text';
import { BoardRow, isSkip, NormalisedJob, SourceRow } from './types';

type Trx = Transaction<DB>;

export type Outcome =
  | { result: 'created' | 'merged' | 'updated'; jobId: string; status: string }
  | { result: 'filtered'; reason: string }
  | { result: 'deferred'; until: Date; reason: string }
  | { result: 'error'; reason: string };

/** Lower is better: when the same job turns up twice, the better source becomes primary. */
const SOURCE_RANK: Record<string, number> = {
  employer_post: 0, platform_post: 0, ats_feed: 1, ngo: 2, remote_board: 3, paid_provider: 3, aggregator: 4, community_paste: 4, social: 5,
};
const MAX_ATTEMPTS = 5;
const MIN_DESCRIPTION = 40;

/**
 * Raw posting → clean job: normalise, (AI for free text), place tags, filters, apply method,
 * scam screening, duplicate merge, expiry. One posting at a time, each in its own transaction.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger('Pipeline');
  private readonly onsiteCountries: Set<string>;

  constructor(
    private readonly db: Db,
    private readonly ai: AiService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.onsiteCountries = new Set(config.INGEST_ONSITE_COUNTRIES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean));
  }

  /** Process postings that are ready. Returns how each one ended. */
  async processBatch(limit = 50): Promise<Record<string, number>> {
    const ids = await this.db.asEngine((trx) =>
      trx
        .selectFrom('raw_postings')
        .select('id')
        .where('status', '=', 'new')
        .where((eb) => eb.or([eb('process_after', 'is', null), eb('process_after', '<=', sql<Date>`now()`)]))
        .orderBy('first_seen_at')
        .limit(limit)
        .execute(),
    );
    const tally: Record<string, number> = {};
    for (const { id } of ids) {
      const out = await this.processOne(id);
      const key = out.result === 'filtered' ? `filtered:${out.reason}` : out.result;
      tally[key] = (tally[key] ?? 0) + 1;
      // Once the AI budget is spent, the rest of the batch would only be deferred too.
      if (out.result === 'deferred' && out.reason === 'ai_budget') break;
    }
    return tally;
  }

  async processOne(rawId: string): Promise<Outcome> {
    try {
      return await this.process(rawId);
    } catch (e) {
      const reason = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 500);
      this.logger.error(`raw ${rawId}: ${reason}`);
      await this.db.asEngine((trx) =>
        trx
          .updateTable('raw_postings')
          .set({
            attempts: sql`attempts + 1`,
            last_error: reason,
            status: sql`CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'error'::raw_status ELSE status END`,
            process_after: sql`now() + make_interval(mins => 5 * (attempts + 1))`,
          })
          .where('id', '=', rawId)
          .execute(),
      );
      return { result: 'error', reason };
    }
  }

  private async process(rawId: string): Promise<Outcome> {
    const raw = await this.db.asEngine((trx) =>
      trx
        .selectFrom('raw_postings as r')
        .innerJoin('sources as s', 's.key', 'r.source_key')
        .leftJoin('source_boards as b', 'b.id', 'r.board_id')
        .leftJoin('employers as e', 'e.id', 'b.employer_id')
        .select([
          'r.id', 'r.source_key', 'r.board_id', 'r.payload', 'r.job_id', 'r.first_seen_at', 'r.url',
          's.name as source_name', 's.kind', 's.config', 's.excluded_origins', 's.default_expiry_days', 's.apply_via_source_link', 's.needs_ai_extraction',
          'b.board_token', 'b.company_name as board_company', 'b.employer_id', 'e.verification as employer_verification',
        ])
        .where('r.id', '=', rawId)
        .executeTakeFirst(),
    );
    if (!raw) return { result: 'error', reason: 'not_found' };

    const source: SourceRow = {
      key: raw.source_key, name: raw.source_name, kind: raw.kind, config: (raw.config ?? {}) as Record<string, unknown>,
      excluded_origins: raw.excluded_origins ?? [], default_expiry_days: raw.default_expiry_days,
      apply_via_source_link: raw.apply_via_source_link, needs_ai_extraction: raw.needs_ai_extraction,
    };
    const board: BoardRow | null = raw.board_id ? { id: raw.board_id, board_token: raw.board_token!, company_name: raw.board_company } : null;
    const connector = connectorFor(source.key);
    if (!connector) return this.filter(rawId, 'no_connector');

    const n0 = connector.normalise(raw.payload, { source, board });
    if (isSkip(n0)) return this.filter(rawId, n0.skip);
    let n: NormalisedJob = n0;

    // Some providers pass on other boards' jobs; their terms or ours exclude some origins.
    const blocked = (n.originHosts ?? []).find((h) => source.excluded_origins.some((o) => h === o || h.endsWith(`.${o}`) || h.includes(o)));
    if (blocked) return this.filter(rawId, `excluded_origin:${blocked}`);

    let aiSummary: string | null = null;
    if (n.needsAi || source.needs_ai_extraction) {
      const extracted = await this.extract(rawId, n, source);
      if ('result' in extracted) return extracted;
      if (!extracted.is_job) return this.filter(rawId, 'ai_not_a_job');
      n = mergeExtract(n, extracted);
      aiSummary = extracted.summary || null;
    }

    if (!n.title || !n.company) return this.filter(rawId, 'missing_title_or_company');
    if (n.description.length < MIN_DESCRIPTION) return this.filter(rawId, 'too_little_detail');

    const where = tagLocation(n.location);
    if (!where.isRemote && !where.countries.some((c) => this.onsiteCountries.has(c))) return this.filter(rawId, 'onsite_outside_area');

    const firstSeen = new Date(raw.first_seen_at as unknown as string);
    const now = new Date();
    if (n.postedAt && now.getTime() - n.postedAt.getTime() > 60 * 86400_000) return this.filter(rawId, 'too_old');
    if (n.deadline && n.deadline.getTime() < now.getTime()) return this.filter(rawId, 'deadline_passed');
    const expiresAt = new Date(Math.min(
      firstSeen.getTime() + source.default_expiry_days * 86400_000,
      n.deadline?.getTime() ?? Infinity,
      firstSeen.getTime() + 60 * 86400_000 - 60_000,
    ));

    // How a member applies.
    const applyUrl = safeUrl(n.applyUrl) ?? safeUrl(n.sourceUrl);
    const applyEmail = n.applyEmail?.toLowerCase() ?? null;
    let applyMethod: 'email' | 'external_link' | 'ats_api';
    if (source.apply_via_source_link) {
      if (!applyUrl) return this.filter(rawId, 'no_apply_link');
      applyMethod = 'external_link';
    } else if (raw.employer_id && ['greenhouse', 'lever', 'ashby'].includes(source.key) && (await this.hasIntegration(raw.employer_id, source.key))) {
      applyMethod = 'ats_api';
    } else if (applyEmail && !safeUrl(n.applyUrl)) {
      applyMethod = 'email';
    } else if (applyUrl) {
      applyMethod = 'external_link';
    } else {
      return this.filter(rawId, 'no_way_to_apply');
    }

    const trust: 'verified_employer' | 'careers_page' | 'unverified' =
      source.kind === 'ats_feed' ? (raw.employer_verification === 'verified' ? 'verified_employer' : 'careers_page') : 'unverified';

    const employment = employmentType(...(n.employmentHints ?? []), n.title);
    const pay = n.pay ?? { minMinor: null, maxMinor: null, currency: null, period: null };

    // Scam screening: rules for all, a confirmed-scam fingerprint list, AI only for the unclear middle.
    const rules = screen({ title: n.title, company: n.company, description: n.description, applyEmail, applyUrl, payMaxMinor: pay.maxMinor, payCurrency: pay.currency, payPeriod: pay.period });
    const fingerprint = textHash(n.description);
    const known = await this.db.asEngine((trx) => trx.selectFrom('scam_signatures').select('id').where('text_hash', '=', fingerprint).executeTakeFirst());
    let risk = known ? 1 : rules.score;
    const reasons = known ? ['matches_confirmed_scam', ...rules.reasons] : [...rules.reasons];
    if (!known && trust === 'unverified' && risk >= SCAM_REVIEW && risk < SCAM_BLOCK && this.ai.enabled) {
      const p = scamCheckPrompt({ title: n.title, company: n.company, description: n.description, applyEmail, applyUrl }, rules.reasons);
      try {
        const r = await this.ai.run({ task: 'scam_check', ...p, schema: ScamCheck, subject: { type: 'raw_posting', id: rawId } });
        risk = r.data.verdict === 'scam' ? Math.max(risk, SCAM_BLOCK) : r.data.verdict === 'ok' ? Math.min(risk, SCAM_REVIEW - 0.01) : risk;
        reasons.push(...r.data.reasons.map((x) => `ai:${x}`));
      } catch (e) {
        if (!(e instanceof AiBudgetExhausted || e instanceof AiRateLimited || e instanceof AiBadOutput)) throw e;
        reasons.push('ai_check_unavailable'); // a person reviews it instead
      }
    }
    const status: 'live' | 'pending_review' | 'scam' = risk >= SCAM_BLOCK ? 'scam' : risk >= SCAM_REVIEW ? 'pending_review' : 'live';

    const description = truncate(n.description, 20_000);
    const fields = {
      company_name: oneLine(n.company, 120),
      company_logo_url: n.companyLogo ?? null,
      title: oneLine(n.title, 200),
      description,
      summary: aiSummary ?? firstWords(description),
      location_scope: where.scope,
      allowed_countries: where.countries,
      allowed_regions: where.regions,
      tz_min_offset_hours: where.tzMin,
      tz_max_offset_hours: where.tzMax,
      is_remote: where.isRemote,
      employment_type: employment,
      seniority: seniority(n.title, n.seniorityHint),
      salary_min_minor: pay.minMinor,
      salary_max_minor: pay.maxMinor,
      salary_currency: pay.currency,
      salary_period: pay.period,
      skills: (n.skills ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean).slice(0, 15),
      apply_method: applyMethod,
      apply_email: applyMethod === 'email' ? applyEmail : null,
      apply_url: applyMethod === 'email' ? null : applyUrl,
      trust,
      employer_id: raw.employer_id,
      category: categorise({ title: n.title, employment, sourceLabels: n.labels, description, ngo: source.kind === 'ngo' }),
      dedupe_key: dedupeKey(n.company, n.title, where.isRemote, where.countries),
      original_posted_at: n.postedAt ?? null,
      deadline_at: n.deadline ?? null,
      suitable_for_minors: false,
    };

    // Pasted by a community owner: theirs, short-lived, and held until the owner confirms it.
    const pasted = source.kind === 'community_paste';
    if (pasted) {
      const communityId = (raw.payload as { community_id?: string }).community_id ?? null;
      const job = await this.db.asEngine(async (trx) => {
        const row = await trx
          .insertInto('jobs')
          .values({
            ...fields, community_id: communityId, primary_source_key: source.key, first_seen_at: firstSeen,
            status: status === 'scam' ? 'scam' : 'pending_review',
            expires_at: new Date(Math.min(expiresAt.getTime(), firstSeen.getTime() + 21 * 86400_000)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.insertInto('job_sources').values({ job_id: row.id, raw_posting_id: rawId, source_key: source.key, apply_url: applyUrl, is_primary: true }).execute();
        await this.markRaw(trx, rawId, 'extracted', row.id);
        if (status !== 'live') await this.flag(trx, row.id, reasons, risk);
        return row;
      });
      return { result: 'created', jobId: job.id, status: status === 'scam' ? 'scam' : 'pending_review' };
    }

    return this.db.asEngine(async (trx) => {
      // The same posting changed at the source: update its job if this source is the primary one.
      if (raw.job_id) {
        const primary = await trx.selectFrom('job_sources').select('is_primary').where('raw_posting_id', '=', rawId).executeTakeFirst();
        if (primary?.is_primary) {
          await trx.updateTable('jobs').set({ ...fields, status: status === 'live' ? sql`CASE WHEN status IN ('expired','removed') THEN status ELSE 'live'::job_status END` : status }).where('id', '=', raw.job_id).execute();
        }
        await this.markRaw(trx, rawId, primary?.is_primary ? 'extracted' : 'merged', raw.job_id);
        if (status !== 'live') await this.flag(trx, raw.job_id, reasons, risk);
        return { result: 'updated', jobId: raw.job_id, status };
      }

      // Already have this job from another source?
      const twin = await trx
        .selectFrom('jobs as j')
        .innerJoin('sources as s', 's.key', 'j.primary_source_key')
        .select(['j.id', 'j.status', 's.kind as primary_kind'])
        .where('j.status', 'in', ['live', 'pending_review'])
        .where((eb) => eb.or([eb('j.dedupe_key', '=', fields.dedupe_key), ...(applyUrl && applyMethod !== 'email' ? [eb('j.apply_url', '=', applyUrl)] : [])]))
        .orderBy('j.first_seen_at')
        .limit(1)
        .executeTakeFirst();

      if (twin && status !== 'scam') {
        const better = (SOURCE_RANK[source.kind] ?? 9) < (SOURCE_RANK[twin.primary_kind] ?? 9);
        if (better) {
          await trx.updateTable('job_sources').set({ is_primary: false }).where('job_id', '=', twin.id).execute();
          await trx.updateTable('jobs').set({ ...fields, primary_source_key: source.key, expires_at: expiresAt }).where('id', '=', twin.id).execute();
        }
        await trx
          .insertInto('job_sources')
          .values({ job_id: twin.id, raw_posting_id: rawId, source_key: source.key, source_url: safeUrl(n.sourceUrl), apply_url: applyUrl, is_primary: better })
          .execute();
        await this.markRaw(trx, rawId, 'merged', twin.id);
        return { result: 'merged', jobId: twin.id, status: twin.status };
      }

      const job = await trx
        .insertInto('jobs')
        .values({ ...fields, primary_source_key: source.key, status, first_seen_at: firstSeen, expires_at: expiresAt })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('job_sources')
        .values({ job_id: job.id, raw_posting_id: rawId, source_key: source.key, source_url: safeUrl(n.sourceUrl), apply_url: applyUrl, is_primary: true })
        .execute();
      await this.markRaw(trx, rawId, 'extracted', job.id);
      if (status !== 'live') await this.flag(trx, job.id, reasons, risk);
      return { result: 'created', jobId: job.id, status };
    });
  }

  private async extract(rawId: string, n: NormalisedJob, source: SourceRow): Promise<JobExtract | Outcome> {
    const p = jobExtractPrompt(n.description, { sourceName: source.name, postedAt: n.postedAt });
    try {
      const r = await this.ai.run({ task: 'job_extract', ...p, schema: JobExtract, subject: { type: 'raw_posting', id: rawId } });
      return r.data;
    } catch (e) {
      if (e instanceof AiBudgetExhausted) return this.defer(rawId, e.resumeAt, 'ai_budget');
      if (e instanceof AiRateLimited) return this.defer(rawId, new Date(Date.now() + e.retryAfterSeconds * 1000), 'ai_rate_limited');
      if (e instanceof AiBadOutput) return this.filter(rawId, 'ai_bad_output');
      throw e;
    }
  }

  private async hasIntegration(employerId: string, provider: string) {
    const row = await this.db.asEngine((trx) =>
      trx.selectFrom('employer_integrations').select('id').where('employer_id', '=', employerId).where('provider', '=', provider).where('revoked_at', 'is', null).executeTakeFirst(),
    );
    return !!row;
  }

  private async filter(rawId: string, reason: string): Promise<Outcome> {
    await this.db.asEngine((trx) =>
      trx.updateTable('raw_postings').set({ status: 'filtered_out', filter_reason: reason.slice(0, 200), last_error: null, process_after: null }).where('id', '=', rawId).execute(),
    );
    return { result: 'filtered', reason };
  }

  private async defer(rawId: string, until: Date, reason: string): Promise<Outcome> {
    await this.db.asEngine((trx) =>
      trx.updateTable('raw_postings').set({ process_after: until, last_error: reason }).where('id', '=', rawId).execute(),
    );
    return { result: 'deferred', until, reason };
  }

  private async markRaw(trx: Trx, rawId: string, status: 'extracted' | 'merged', jobId: string) {
    await trx.updateTable('raw_postings').set({ status, job_id: jobId, last_error: null, process_after: null, filter_reason: null }).where('id', '=', rawId).execute();
  }

  /** Into the moderators' queue. The reasons stay internal. */
  private async flag(trx: Trx, jobId: string, reasons: string[], risk: number) {
    const open = await trx.selectFrom('moderation_items').select('id').where('subject_type', '=', 'job').where('subject_id', '=', jobId).where('status', 'in', ['open', 'in_review', 'escalated']).executeTakeFirst();
    if (open) return;
    await trx
      .insertInto('moderation_items')
      .values({ subject_type: 'job', subject_id: jobId, reason_internal: `scam screening: ${reasons.join(', ') || 'unclear'}`, risk_score: Math.min(1, Math.max(0, risk)).toFixed(3) })
      .execute();
  }
}

/** AI fills only what the post itself didn't give us. */
function mergeExtract(n: NormalisedJob, x: JobExtract): NormalisedJob {
  // Region names go in as words the location tagger already knows ("north america", "middle east").
  const texts = [x.location_text, x.worldwide ? 'Worldwide' : null, ...x.regions.map((r) => r.replace('_', ' '))].filter((t): t is string => !!t);
  const pay = x.pay_min || x.pay_max ? payFromNumbers(x.pay_min, x.pay_max, x.pay_currency, x.pay_period) : null;
  return {
    ...n,
    title: n.title || x.title,
    company: n.company || x.company,
    companyDomain: n.companyDomain ?? hostOf(x.company_website),
    applyUrl: n.applyUrl ?? x.apply_url,
    applyEmail: n.applyEmail ?? x.apply_email,
    location: {
      ...n.location,
      texts: [...(n.location.texts ?? []), ...texts],
      remote: n.location.remote ?? x.remote,
      countries: [...(n.location.countries ?? []), ...x.countries],
    },
    employmentHints: [...(n.employmentHints ?? []), x.employment_type],
    pay: n.pay?.currency ? n.pay : pay,
    deadline: n.deadline ?? (x.deadline ? new Date(`${x.deadline}T23:59:59Z`) : null),
    skills: n.skills?.length ? n.skills : x.skills,
  };
}

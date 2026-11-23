import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Db } from '../db/db.service';
import { regionsOf } from '../ingest/places';
import { QUEUES, QueueService } from '../queues/queue.service';
import { EmbeddingService, EmbedRateLimited, toVector } from './embedding.service';
import { fit, JobFacts, MemberFacts } from './scoring';

export const MIN_SCORE = 35;
export const MAX_MATCHES_PER_MEMBER = 150;
const CANDIDATES = 300;

interface Member extends MemberFacts {
  userId: string;
  countries: string[];
  regions: string[];
  minor: boolean;
  embedding: string | null;
}

const JOB_COLUMNS = sql`j.id, j.title, j.skills, j.description, j.seniority, j.employment_type, j.location_scope,
  j.allowed_countries, j.is_remote, j.tz_min_offset_hours, j.tz_max_offset_hours, j.suitable_for_minors`;

/** Which jobs a member may see: where the employer hires, on-site only in their countries, minors only suitable jobs. */
const eligible = (m: Member) => sql`(
  (mj.location_scope IN ('worldwide', 'unspecified')
    OR (mj.location_scope = 'restricted' AND (mj.allowed_countries && ${m.countries}::char(2)[] OR mj.allowed_regions && ${m.regions}::text[])))
  AND (mj.is_remote OR mj.allowed_countries && ${m.countries}::char(2)[])
  AND (NOT ${m.minor}::boolean OR mj.suitable_for_minors))`;

@Injectable()
export class MatchService {
  private readonly logger = new Logger('Matching');

  constructor(
    private readonly db: Db,
    private readonly embeddings: EmbeddingService,
    private readonly queues: QueueService,
  ) {}

  // ---------------------------------------------------------------- embeddings

  /** Embed live jobs that may be matched and don't have a vector yet. */
  async embedJobs(limit = 64): Promise<number> {
    if (!this.embeddings.enabled) return 0;
    const jobs = await this.db.asEngine((trx) =>
      sql<{ id: string; title: string; company_name: string; category: string | null; skills: string[]; description: string }>`
        SELECT id, title, company_name, category, skills, description FROM matchable_jobs
         WHERE embedding IS NULL ORDER BY first_seen_at DESC LIMIT ${limit}`.execute(trx),
    );
    const texts = jobs.rows.map(jobText);
    let done = 0;
    while (done < texts.length) {
      const n = this.embeddings.batchSize(texts.slice(done));
      let vectors: number[][];
      try {
        vectors = await this.embeddings.embed(texts.slice(done, done + n), 'document');
      } catch (e) {
        if (e instanceof EmbedRateLimited) break; // the next run picks up the rest
        throw e;
      }
      await this.db.asEngine(async (trx) => {
        for (let i = 0; i < vectors.length; i++) {
          await trx.updateTable('jobs').set({ embedding: toVector(vectors[i]), embedded_at: sql`now()` }).where('id', '=', jobs.rows[done + i].id).execute();
        }
      });
      done += n;
    }
    return done;
  }

  /** Embed a profile if its text changed. Returns the vector (as text) or null. */
  async embedProfile(userId: string): Promise<string | null> {
    const p = await this.db.asEngine((trx) => trx.selectFrom('profiles').select(['headline', 'summary', 'skills', 'experience', 'embedding', 'embedded_text_hash']).where('user_id', '=', userId).executeTakeFirst());
    if (!p) return null;
    const text = profileText(p);
    const hash = createHash('sha256').update(text).digest('hex');
    if (p.embedded_text_hash === hash && p.embedding) return p.embedding as unknown as string;
    if (!this.embeddings.enabled || text.length < 20) return null;
    try {
      const [v] = await this.embeddings.embed([text], 'query');
      const vec = toVector(v);
      await this.db.asEngine((trx) => trx.updateTable('profiles').set({ embedding: vec, embedded_text_hash: hash }).where('user_id', '=', userId).execute());
      return vec;
    } catch (e) {
      if (e instanceof EmbedRateLimited) return (p.embedding as unknown as string) ?? null; // use the old one for now
      throw e;
    }
  }

  // ---------------------------------------------------------------- one member

  /** Recompute one member's matches against every live job they may take. */
  async matchMember(userId: string): Promise<{ matched: number }> {
    const member = await this.member(userId);
    if (!member) {
      await this.db.asEngine((trx) => trx.deleteFrom('matches').where('user_id', '=', userId).where('status', '=', 'new').execute());
      return { matched: 0 };
    }
    member.embedding = await this.embedProfile(userId);

    const terms = [...(member.headline ? [member.headline] : []), ...member.skills.slice(0, 10)]
      .flatMap((t) => t.toLowerCase().split(/[^a-z0-9+#]+/))
      .filter((w) => w.length > 2)
      .slice(0, 14);
    const lowerSkills = member.skills.map((s) => s.toLowerCase());
    const vec = member.embedding;

    const rows = await this.db.asEngine((trx) =>
      sql<any>`
        WITH cand AS (
          ${vec ? sql`(SELECT mj.id FROM matchable_jobs mj WHERE ${eligible(member)} AND mj.embedding IS NOT NULL
                        ORDER BY mj.embedding <=> ${vec}::vector LIMIT ${CANDIDATES}) UNION` : sql``}
          (SELECT mj.id FROM matchable_jobs mj WHERE ${eligible(member)}
             AND (mj.skills && ${lowerSkills}::text[] ${terms.length ? sql`OR mj.search @@ websearch_to_tsquery('english', ${terms.join(' or ')})` : sql``})
           ORDER BY mj.first_seen_at DESC LIMIT ${CANDIDATES})
        )
        SELECT ${JOB_COLUMNS}, ${vec ? sql`CASE WHEN j.embedding IS NOT NULL THEN 1 - (j.embedding <=> ${vec}::vector) END` : sql`NULL::float8`} AS similarity
          FROM jobs j JOIN (SELECT DISTINCT id FROM cand) c ON c.id = j.id`.execute(trx),
    );

    const scored = rows.rows
      .map((j) => ({ jobId: j.id as string, f: fit(member, jobFacts(j), j.similarity === null ? null : Number(j.similarity)) }))
      .filter((x): x is { jobId: string; f: NonNullable<ReturnType<typeof fit>> } => !!x.f && x.f.score >= MIN_SCORE)
      .sort((a, b) => b.f.score - a.f.score)
      .slice(0, MAX_MATCHES_PER_MEMBER);

    await this.save(member, scored, true);
    await this.db.asEngine((trx) => trx.updateTable('profiles').set({ matched_at: sql`now()` }).where('user_id', '=', userId).execute());
    return { matched: scored.length };
  }

  // ---------------------------------------------------------------- new jobs

  /** Match jobs nobody has been matched to yet against members who might fit. */
  async matchNewJobs(limit = 50): Promise<{ jobs: number; matches: number }> {
    // Wait up to two hours for a job's embedding when embeddings are on; then match on skills alone.
    const jobs = await this.db.asEngine((trx) =>
      sql<any>`SELECT id, embedding::text AS embedding, skills, title FROM matchable_jobs
                WHERE matched_at IS NULL
                  AND (${!this.embeddings.enabled}::boolean OR embedding IS NOT NULL OR first_seen_at < now() - interval '2 hours')
                ORDER BY first_seen_at LIMIT ${limit}`.execute(trx),
    );
    let total = 0;
    for (const job of jobs.rows) {
      const titleWords = String(job.title).toLowerCase().split(/[^a-z0-9+#]+/).filter((w: string) => w.length > 3);
      const profiles = await this.db.asEngine((trx) =>
        sql<{ user_id: string }>`
          ${job.embedding ? sql`(SELECT user_id FROM profiles WHERE embedding IS NOT NULL ORDER BY embedding <=> ${job.embedding}::vector LIMIT 500) UNION` : sql``}
          (SELECT user_id FROM profiles p
            WHERE EXISTS (SELECT 1 FROM unnest(p.skills) s WHERE lower(s) = ANY(${job.skills}::text[]))
               ${titleWords.length ? sql`OR lower(coalesce(p.headline, '')) ~ ${`\\m(${titleWords.map((w: string) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean).join('|')})\\M`}` : sql``}
            LIMIT 2000)`.execute(trx),
      );
      for (const { user_id } of profiles.rows) {
        const member = await this.member(user_id);
        if (!member) continue;
        const r = await this.db.asEngine((trx) =>
          sql<any>`SELECT ${JOB_COLUMNS}, ${member.embedding && job.embedding ? sql`1 - (j.embedding <=> ${member.embedding}::vector)` : sql`NULL::float8`} AS similarity
                     FROM jobs j JOIN matchable_jobs mj ON mj.id = j.id WHERE j.id = ${job.id} AND ${eligible(member)}`.execute(trx),
        );
        const row = r.rows[0];
        if (!row) continue;
        const f = fit(member, jobFacts(row), row.similarity === null ? null : Number(row.similarity));
        if (!f || f.score < MIN_SCORE) continue;
        await this.save(member, [{ jobId: job.id, f }], false);
        total++;
      }
      await this.db.asEngine((trx) => trx.updateTable('jobs').set({ matched_at: sql`now()` }).where('id', '=', job.id).execute());
    }
    return { jobs: jobs.rows.length, matches: total };
  }

  /** Nightly: queue a full refresh for members not refreshed in the last day. */
  async queueStaleMembers(limit = 2000): Promise<number> {
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('profiles').select('user_id').where((eb) => eb.or([eb('matched_at', 'is', null), eb('matched_at', '<', sql<Date>`now() - interval '20 hours'`)])).limit(limit).execute(),
    );
    for (const { user_id } of rows) {
      await this.queues.add(QUEUES.match, 'user', { userId: user_id }, { jobId: `match-user-${user_id}-${new Date().toISOString().slice(0, 10)}`, attempts: 2 });
    }
    return rows.length;
  }

  // ---------------------------------------------------------------- internals

  private async member(userId: string): Promise<Member | null> {
    const row = await this.db.asEngine((trx) =>
      trx
        .selectFrom('profiles as p')
        .innerJoin('users as u', 'u.id', 'p.user_id')
        .select(['p.user_id', 'p.headline', 'p.skills', 'p.experience', 'p.years_experience', 'p.country', 'p.utc_offset_hours', 'p.work_authorization', 'p.embedding', 'u.age_band', 'u.status'])
        .where('p.user_id', '=', userId)
        .executeTakeFirst(),
    );
    if (!row || row.status !== 'active' || row.age_band === 'under_13') return null;
    const auth = (row.work_authorization ?? {}) as { countries?: string[] };
    const countries = [...new Set([row.country, ...(auth.countries ?? [])].filter((c): c is string => !!c).map((c) => c.toUpperCase()))];
    return {
      userId,
      skills: row.skills ?? [],
      headline: row.headline,
      titles: ((row.experience ?? []) as { title?: string }[]).map((e) => e.title ?? '').filter(Boolean).slice(0, 6),
      years: row.years_experience === null ? null : Number(row.years_experience),
      country: row.country?.toUpperCase() ?? null,
      utcOffset: row.utc_offset_hours,
      countries,
      regions: [...new Set(countries.flatMap(regionsOf))],
      minor: row.age_band === 'teen',
      embedding: (row.embedding as unknown as string) ?? null,
    };
  }

  /** Upsert matches (keeping the member's seen/saved/dismissed status); with `replace`, drop stale unseen ones. */
  private async save(member: Member, scored: { jobId: string; f: { score: number; reasons: string[]; gaps: string[] } }[], replace: boolean) {
    const allGaps = [...new Set(scored.flatMap((s) => s.f.gaps))];
    const trainings = allGaps.length
      ? await this.db.asEngine((trx) =>
          sql<{ id: string; skill: string }>`
            SELECT DISTINCT ON (g.skill) t.id, g.skill FROM unnest(${allGaps}::text[]) AS g(skill)
              JOIN trainings t ON t.active AND EXISTS (SELECT 1 FROM unnest(t.skills) s WHERE lower(s) = g.skill)
             WHERE (NOT ${member.minor}::boolean OR t.suitable_for_minors)
               -- Skip courses the member already finished on that partner site.
               AND NOT EXISTS (SELECT 1 FROM site_accounts sa WHERE sa.user_id = ${member.userId} AND sa.site_id = t.site_id AND t.external_id = ANY(sa.completed_trainings))
             ORDER BY g.skill, t.is_free DESC, t.duration_minutes NULLS LAST`.execute(trx),
        )
      : { rows: [] };
    const trainingFor = new Map(trainings.rows.map((t) => [t.skill, t.id]));

    await this.db.asEngine(async (trx) => {
      for (const s of scored) {
        const gaps = s.f.gaps.map((skill) => ({ skill, training_id: trainingFor.get(skill) ?? null }));
        const pathways = gaps.filter((g) => !g.training_id).map((g) => `Learn ${g.skill} with free guides or a short course, then add it to your profile`);
        const values = { score: s.f.score, reasons: JSON.stringify(s.f.reasons), gaps: JSON.stringify(gaps), pathways: JSON.stringify(pathways) };
        await trx
          .insertInto('matches')
          .values({ user_id: member.userId, job_id: s.jobId, ...values })
          .onConflict((oc) => oc.columns(['user_id', 'job_id']).doUpdateSet({ ...values, computed_at: sql`now()` }))
          .execute();
      }
      if (replace) {
        const keep = scored.map((s) => s.jobId);
        await trx
          .deleteFrom('matches')
          .where('user_id', '=', member.userId)
          .where('status', '=', 'new')
          .$if(keep.length > 0, (q) => q.where('job_id', 'not in', keep))
          .execute();
      } else {
        // Keep each member's list to their best ones.
        await sql`DELETE FROM matches WHERE user_id = ${member.userId} AND status = 'new' AND job_id IN (
                    SELECT job_id FROM matches WHERE user_id = ${member.userId} ORDER BY score DESC OFFSET ${MAX_MATCHES_PER_MEMBER})`.execute(trx);
      }
    });
  }
}

function jobFacts(j: any): JobFacts {
  return {
    title: j.title,
    skills: j.skills ?? [],
    text: `${j.title}\n${j.description ?? ''}`,
    seniority: j.seniority,
    employment_type: j.employment_type,
    location_scope: j.location_scope,
    allowed_countries: (j.allowed_countries ?? []).map((c: string) => c.trim()),
    is_remote: j.is_remote,
    tz_min: j.tz_min_offset_hours,
    tz_max: j.tz_max_offset_hours,
  };
}

export function jobText(j: { title: string; company_name: string; category: string | null; skills: string[]; description: string }) {
  return [j.title, j.company_name, j.category ?? '', j.skills.length ? `Skills: ${j.skills.join(', ')}` : '', j.description.slice(0, 2500)].filter(Boolean).join('\n');
}

export function profileText(p: { headline: string | null; summary: string | null; skills: string[]; experience: unknown }) {
  const exp = ((p.experience ?? []) as { title?: string; company?: string; highlights?: string[] }[])
    .slice(0, 5)
    .map((e) => [e.title, e.company && `at ${e.company}`, ...(e.highlights ?? []).slice(0, 2)].filter(Boolean).join(' '));
  return [p.headline ?? '', p.summary ?? '', p.skills.length ? `Skills: ${p.skills.join(', ')}` : '', ...exp].filter(Boolean).join('\n');
}

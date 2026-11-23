import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessService } from '../account/access.service';
import { nextUtcMidnight } from '../ai/ai.service';
import { randomToken } from '../common/crypto';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { CV_TYPES } from './cv-text';
import { strength, utcOffsetHours } from './strength';

export const CONFIRM_EVERY_DAYS = 90;
const UPLOAD_TTL_SECONDS = 3600;

export interface ProfileInput {
  headline?: string;
  summary?: string;
  years_experience?: number;
  country?: string;
  city?: string;
  timezone?: string;
  work_authorization?: { remote_any_country?: boolean; countries?: string[] };
  skills?: string[];
  experience?: { title: string; company?: string; start?: string | null; end?: string | null; highlights?: string[] }[];
  education?: { school: string; qualification?: string; year?: number | null }[];
  languages?: string[];
  links?: string[];
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly access: AccessService,
  ) {}

  async get(userId: string) {
    const row = await this.db.k.selectFrom('profiles').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!row) throw Problem.notFound('profile_not_found', 'No profile yet. Upload a CV or fill it in.');
    return this.view(row);
  }

  async update(userId: string, input: ProfileInput) {
    const values: Record<string, unknown> = {};
    for (const k of ['headline', 'summary', 'years_experience', 'city', 'timezone'] as const) if (input[k] !== undefined) values[k] = input[k];
    if (input.country !== undefined) values.country = input.country.toUpperCase();
    if (input.timezone !== undefined) values.utc_offset_hours = utcOffsetHours(input.timezone);
    if (input.work_authorization !== undefined) {
      values.work_authorization = JSON.stringify({
        remote_any_country: input.work_authorization.remote_any_country ?? false,
        countries: (input.work_authorization.countries ?? []).map((c) => c.toUpperCase()),
      });
    }
    if (input.skills !== undefined) values.skills = cleanList(input.skills, 40);
    if (input.languages !== undefined) values.languages = cleanList(input.languages, 10);
    if (input.experience !== undefined) values.experience = JSON.stringify(input.experience);
    if (input.education !== undefined) values.education = JSON.stringify(input.education);
    if (input.links !== undefined) values.links = JSON.stringify(input.links);

    await this.db.asEngine(async (trx) => {
      await trx
        .insertInto('profiles')
        .values({ user_id: userId, ...values })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
        .execute();
      await this.refreshStrength(trx, userId);
    });
    await this.queueMatch(userId);
    return this.get(userId);
  }

  async confirm(userId: string) {
    const r = await this.db.asEngine((trx) => trx.updateTable('profiles').set({ confirmed_at: sql`now()` }).where('user_id', '=', userId).executeTakeFirst());
    if (!Number(r.numUpdatedRows)) throw Problem.notFound('profile_not_found', 'No profile yet. Upload a CV or fill it in.');
    await this.db.asEngine((trx) => this.refreshStrength(trx, userId));
    return this.get(userId);
  }

  /** A signed link for the browser to upload the CV straight to storage. */
  async startUpload(userId: string, file: { file_name: string; content_type: string; size_bytes: number }) {
    const ext = file.content_type === CV_TYPES.pdf ? 'pdf' : 'docx';
    const key = `cv/${userId}/${randomUUID()}.${ext}`;
    const uploadId = `up_${randomToken(16)}`;
    const url = await this.storage.uploadUrl(key, file.content_type, file.size_bytes);
    await this.redis.client.set(`cvupload:${uploadId}`, JSON.stringify({ userId, key, contentType: file.content_type, size: file.size_bytes }), 'EX', UPLOAD_TTL_SECONDS);
    return { upload_id: uploadId, upload_url: url, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
  }

  /** Queue the CV for reading. Answers at once; the profile.ready notification follows. */
  async requestParse(userId: string, siteId: string, uploadId: string) {
    await this.access.assertConsent(userId, 'matching');
    const raw = await this.redis.client.get(`cvupload:${uploadId}`);
    const upload = raw ? (JSON.parse(raw) as { userId: string; key: string; contentType: string; size: number }) : null;
    if (!upload || upload.userId !== userId) throw Problem.notFound('upload_not_found', 'This upload has expired. Start a new one.');
    const stored = await this.storage.stat(upload.key);
    if (!stored) throw Problem.conflict('upload_missing', 'The file has not finished uploading yet');
    if (stored.size > 5 * 1024 * 1024) throw Problem.unprocessable('file_too_big', 'The CV must be 5 MB or smaller');

    // Tell the member now if today's free AI budget is already spent.
    const budget = await this.db.k.selectFrom('ai_budget_today').select(['remaining_tokens']).where('task', '=', 'cv_parse').executeTakeFirst();
    const est = await this.db.k.selectFrom('ai_task_budgets').select('est_tokens_per_call').where('task', '=', 'cv_parse').executeTakeFirst();
    const waitForTomorrow = Number(budget?.remaining_tokens ?? 0) < Number(est?.est_tokens_per_call ?? 0);
    const scheduledFor = waitForTomorrow ? nextUtcMidnight() : null;

    const work = await this.db.asEngine((trx) =>
      trx
        .insertInto('work_items')
        .values({
          kind: 'cv_parse',
          status: waitForTomorrow ? 'scheduled' : 'queued',
          user_id: userId,
          site_id: siteId,
          input: JSON.stringify({ key: upload.key, content_type: upload.contentType }),
          scheduled_for: scheduledFor,
        })
        .returning(['id', 'kind', 'status', 'scheduled_for'])
        .executeTakeFirstOrThrow(),
    );
    await this.redis.client.del(`cvupload:${uploadId}`);
    await this.queues.add(QUEUES.ai, 'cv_parse', { workId: work.id }, {
      jobId: `cv_parse-${work.id}`,
      delay: scheduledFor ? scheduledFor.getTime() - Date.now() : 0,
      attempts: 3,
    });
    return {
      work_id: work.id,
      kind: work.kind,
      status: work.status,
      scheduled_for: scheduledFor?.toISOString() ?? null,
      reason: waitForTomorrow ? 'daily_ai_budget' : null,
    };
  }

  async queueMatch(userId: string) {
    // Debounced: several edits in a row cause one recompute.
    await this.queues.add(QUEUES.match, 'user', { userId }, { jobId: `match-user-${userId}-${Math.floor(Date.now() / 30_000)}`, delay: 3_000, attempts: 3 });
  }

  async refreshStrength(trx: Parameters<Parameters<Db['asEngine']>[0]>[0], userId: string) {
    const p = await trx.selectFrom('profiles').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!p) return;
    await trx.updateTable('profiles').set({ strength: strength(shape(p)).score }).where('user_id', '=', userId).execute();
  }

  view(row: any) {
    const s = strength(shape(row));
    const confirmed = row.confirmed_at ? new Date(row.confirmed_at) : null;
    return {
      headline: row.headline ?? '',
      summary: row.summary ?? '',
      years_experience: row.years_experience === null ? null : Number(row.years_experience),
      country: row.country,
      city: row.city,
      timezone: row.timezone,
      work_authorization: { remote_any_country: false, countries: [], ...(row.work_authorization ?? {}) },
      skills: row.skills ?? [],
      experience: row.experience ?? [],
      education: row.education ?? [],
      languages: row.languages ?? [],
      links: row.links ?? [],
      strength: s.score,
      strength_tips: s.tips,
      cv: { uploaded: !!row.cv_file_key, parsed_at: row.cv_parsed_at ? new Date(row.cv_parsed_at).toISOString() : null },
      confirmed_at: confirmed?.toISOString() ?? null,
      needs_confirmation: !confirmed || Date.now() - confirmed.getTime() > CONFIRM_EVERY_DAYS * 86400_000,
    };
  }
}

export function shape(row: any) {
  return {
    ...row,
    links: row.links ?? [],
    experience: row.experience ?? [],
    education: row.education ?? [],
    confirmed_at: row.confirmed_at,
  };
}

function cleanList(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v.slice(0, 50));
    if (out.length >= max) break;
  }
  return out;
}
export { cleanList };

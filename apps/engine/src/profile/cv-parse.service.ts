import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AiBadOutput, AiBudgetExhausted, AiRateLimited, AiService } from '../ai/ai.service';
import { CvParse, cvParsePrompt } from '../ai/prompts';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { StorageService } from '../storage/storage.service';
import { cvText, CvUnreadable } from './cv-text';
import { cleanList, ProfileService } from './profile.service';
import { utcOffsetHours, yearsFromExperience } from './strength';

export type CvParseOutcome = 'done' | 'scheduled' | 'retry' | 'failed' | 'skipped';

/** Worker side of CV reading: file → text → AI → profile, then matching. */
@Injectable()
export class CvParseService {
  private readonly logger = new Logger('CvParse');

  constructor(
    private readonly db: Db,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly profiles: ProfileService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async run(workId: string): Promise<CvParseOutcome> {
    const work = await this.db.asEngine((trx) => trx.selectFrom('work_items').selectAll().where('id', '=', workId).executeTakeFirst());
    if (!work || work.kind !== 'cv_parse' || work.status === 'done' || work.status === 'failed') return 'skipped';
    const input = work.input as { key: string; content_type: string };
    const userId = work.user_id!;
    await this.setWork(workId, { status: 'running', attempts: sql`attempts + 1` });

    let text: string;
    try {
      text = await cvText(await this.storage.get(input.key), { pdftotext: this.config.PDFTOTEXT_PATH });
    } catch (e) {
      const reason = e instanceof CvUnreadable ? e.message : 'We could not open this file';
      await this.fail(workId, userId, work.site_id!, e instanceof CvUnreadable ? e.reason : 'storage_error', reason);
      if (!(e instanceof CvUnreadable)) this.logger.error(`work ${workId}: ${(e as Error).message}`);
      return 'failed';
    }

    let parsed: CvParse;
    try {
      parsed = (await this.ai.run({ task: 'cv_parse', ...cvParsePrompt(text), schema: CvParse, subject: { type: 'work_item', id: workId } })).data;
    } catch (e) {
      if (e instanceof AiBudgetExhausted || e instanceof AiRateLimited) {
        const at = e instanceof AiBudgetExhausted ? e.resumeAt : new Date(Date.now() + e.retryAfterSeconds * 1000);
        await this.setWork(workId, { status: 'scheduled', scheduled_for: at, error: e instanceof AiBudgetExhausted ? 'daily_ai_budget' : 'ai_busy' });
        await this.queues.add(QUEUES.ai, 'cv_parse', { workId }, { jobId: `cv_parse-${workId}-${at.getTime()}`, delay: Math.max(0, at.getTime() - Date.now()), attempts: 3 });
        return e instanceof AiBudgetExhausted ? 'scheduled' : 'retry';
      }
      if (e instanceof AiBadOutput) {
        await this.fail(workId, userId, work.site_id!, 'ai_bad_output', 'We could not read this CV automatically. You can fill in your profile yourself.');
        return 'failed';
      }
      throw e;
    }

    const previous = await this.db.asEngine((trx) => trx.selectFrom('profiles').select(['cv_file_key', 'country', 'city', 'timezone']).where('user_id', '=', userId).executeTakeFirst());
    const experience = parsed.experience.filter((x) => x.title || x.company).map((x) => ({
      title: x.title, company: x.company, start: x.start, end: x.current ? null : x.end, highlights: x.highlights,
    }));
    const years = yearsFromExperience(parsed.experience) ?? parsed.years_experience;
    // A new CV replaces the CV-derived parts. Where the member lives and their time zone stay as they set them.
    const values = {
      headline: parsed.headline || null,
      summary: parsed.summary || null,
      years_experience: years,
      country: previous?.country ?? parsed.country,
      city: previous?.city ?? parsed.city,
      utc_offset_hours: previous?.timezone ? utcOffsetHours(previous.timezone) : undefined,
      skills: cleanList(parsed.skills, 40),
      experience: JSON.stringify(experience),
      education: JSON.stringify(parsed.education.filter((e) => e.school || e.qualification)),
      languages: cleanList(parsed.languages, 10),
      links: JSON.stringify(parsed.links),
      cv_file_key: input.key,
      cv_parsed_at: new Date(),
      // A new CV means the member should check the profile again before autopilot uses it.
      confirmed_at: null,
    };
    await this.db.asEngine(async (trx) => {
      await trx
        .insertInto('profiles')
        .values({ user_id: userId, ...values })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
        .execute();
      await this.profiles.refreshStrength(trx, userId);
      await trx
        .insertInto('notifications')
        .values({ user_id: userId, site_id: work.site_id!, type: 'profile.ready', title: 'Your profile is ready', body: 'Check it over and confirm it, then we can start matching you to jobs.', data: JSON.stringify({ work_id: workId }) })
        .execute();
    });
    await this.setWork(workId, { status: 'done', result: JSON.stringify({ skills: values.skills.length, roles: experience.length }), error: null });
    if (previous?.cv_file_key && previous.cv_file_key !== input.key) await this.storage.delete(previous.cv_file_key).catch(() => undefined);
    await this.profiles.queueMatch(userId);
    return 'done';
  }

  private async fail(workId: string, userId: string, siteId: string, code: string, message: string) {
    await this.setWork(workId, { status: 'failed', error: code, result: JSON.stringify({ message }) });
    await this.db.asEngine((trx) =>
      trx.insertInto('notifications').values({ user_id: userId, site_id: siteId, type: 'cv.unreadable', title: 'We could not read your CV', body: message, data: JSON.stringify({ work_id: workId, code }) }).execute(),
    );
  }

  private setWork(id: string, values: Record<string, unknown>) {
    return this.db.asEngine((trx) => trx.updateTable('work_items').set(values).where('id', '=', id).execute());
  }
}

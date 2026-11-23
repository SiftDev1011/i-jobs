import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AiBadOutput, AiBudgetExhausted, AiRateLimited, AiService } from '../ai/ai.service';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { StorageService } from '../storage/storage.service';
import { Applicant, AppParagraph, checkClaims, composeLetter, JobForLetter, paragraphPrompt } from './compose';
import { buildMime } from './mime';

export const CHECKIN_AFTER_DAYS = 10;
const MAX_SEND_ATTEMPTS = 3;

class LimitHit extends Error {
  constructor(readonly limit: 'job' | 'user' | 'employer' | 'domain') {
    super(`${limit} limit reached`);
  }
}

export type SendOutcome = 'sent' | 'cancelled' | 'rescheduled' | 'failed' | 'skipped';

/**
 * Sends due autopilot applications: re-checks everything, takes all four sending limits in one
 * transaction (all or none), writes the letter, sends it from the member's relay address with
 * their CV attached, and books a check-in.
 */
@Injectable()
export class SenderService {
  private readonly logger = new Logger('Sender');

  constructor(
    private readonly db: Db,
    private readonly ai: AiService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async sendDue(limit = 30): Promise<Record<string, number>> {
    const due = await this.db.asEngine((trx) =>
      trx
        .selectFrom('applications')
        .select('id')
        .where('status', '=', 'scheduled')
        .where('mode', '=', 'autopilot')
        .where('scheduled_for', '<=', sql<Date>`now()`)
        .orderBy('scheduled_for')
        .limit(limit)
        .execute(),
    );
    const tally: Record<string, number> = {};
    for (const { id } of due) {
      const out = await this.sendOne(id);
      tally[out] = (tally[out] ?? 0) + 1;
    }
    return tally;
  }

  async sendOne(appId: string): Promise<SendOutcome> {
    const a = await this.load(appId);
    if (!a || a.status !== 'scheduled') return 'skipped';

    // Things may have changed since it was planned.
    const stop =
      a.job_status !== 'live' ? 'job_closed'
      : a.user_status !== 'active' ? 'account_inactive'
      : !a.rules_enabled ? 'autopilot_turned_off'
      : !a.autopilot_consent ? 'consent_withdrawn'
      : !a.apply_email ? 'no_email'
      : (await this.suppressed(a.apply_email)) ? 'recipient_suppressed'
      : !a.cv_file_key ? 'no_cv'
      : null;
    if (stop) {
      await this.finish(appId, a.mode === 'autopilot' && stop === 'autopilot_turned_off' ? 'cancelled' : 'failed', stop);
      if (stop === 'job_closed' || stop === 'recipient_suppressed') await this.backToQueue(a.user_id, a.job_id, 'outside_rules');
      return stop === 'autopilot_turned_off' ? 'cancelled' : 'failed';
    }

    // All four limits or none.
    try {
      await this.db.asEngine(async (trx) => {
        const locked = await trx.selectFrom('applications').select('status').where('id', '=', appId).forUpdate().executeTakeFirst();
        if (locked?.status !== 'scheduled') throw new LimitHit('job'); // someone else got it; treated as skip below
        const job = await trx.updateTable('jobs').set({ autopilot_sent: sql`autopilot_sent + 1` }).where('id', '=', a.job_id).whereRef('autopilot_sent', '<', 'autopilot_cap').executeTakeFirst();
        if (!Number(job.numUpdatedRows)) throw new LimitHit('job');
        const take = async (scope: 'user' | 'employer' | 'domain', key: string, max: number) => {
          const r = await sql<{ ok: boolean }>`SELECT try_count_send(${scope}::send_scope, ${key}, ${max}) AS ok`.execute(trx);
          if (!r.rows[0].ok) throw new LimitHit(scope);
        };
        await take('user', a.user_id, a.daily_cap ?? 5);
        await take('employer', a.employer_key ?? a.apply_email!.split('@')[1], this.config.EMPLOYER_DAILY_LIMIT);
        if (a.domain_paused) throw new LimitHit('domain');
        await take('domain', a.relay_domain, a.domain_limit);
        await trx.updateTable('applications').set({ status: 'sending', send_attempts: sql`send_attempts + 1` }).where('id', '=', appId).execute();
      });
    } catch (e) {
      if (!(e instanceof LimitHit)) throw e;
      const now = await this.load(appId);
      if (now?.status !== 'scheduled') return 'skipped';
      if (e.limit === 'job') {
        await this.finish(appId, 'failed', 'job_cap_reached');
        await this.backToQueue(a.user_id, a.job_id, 'job_cap_reached');
        return 'failed';
      }
      // A daily limit: try again tomorrow morning, Lagos time.
      await this.db.asEngine((trx) => trx.updateTable('applications').set({ scheduled_for: tomorrowMorning() }).where('id', '=', appId).execute());
      return 'rescheduled';
    }

    try {
      const applicant = await this.applicant(a.user_id);
      const job: JobForLetter = { title: a.title, company: a.company_name, description: a.description, skills: a.skills ?? [] };
      const paragraph = await this.paragraph(appId, applicant, job);
      const letter = composeLetter(applicant, job, paragraph);
      const cv = await this.storage.get(a.cv_file_key!);
      const ext = a.cv_file_key!.endsWith('.pdf') ? 'pdf' : 'docx';
      const filename = `${applicant.fullName.replace(/[^\p{L}\p{N} ]/gu, '').trim().replace(/\s+/g, '_') || 'CV'}_CV.${ext}`;
      const from = { name: applicant.fullName, address: a.relay_address };
      const raw = buildMime({
        from, to: a.apply_email!, replyTo: a.relay_address, subject: letter.subject, text: letter.body,
        attachments: [{ filename, contentType: ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: cv }],
        headers: { 'X-Ijobs-Application': appId },
      });
      const messageId = await this.mail.sendRaw({ from: a.relay_address, to: a.apply_email!, raw, configurationSet: this.config.SES_CONFIGURATION_SET_RELAY });

      await this.db.asEngine(async (trx) => {
        await trx
          .updateTable('applications')
          .set({
            status: 'sent', sent_at: sql`now()`, claims_checked: letter.claimsChecked, failed_reason: null,
            content: JSON.stringify({ to: a.apply_email, from: `${from.name} <${from.address}>`, subject: letter.subject, body: letter.body, attachments: [filename] }),
          })
          .where('id', '=', appId)
          .execute();
        await trx.insertInto('email_messages').values({
          direction: 'outbound', user_id: a.user_id, application_id: appId, relay_address_id: a.relay_address_id, from_addr: a.relay_address,
          to_addr: a.apply_email!, subject: letter.subject, provider_message_id: messageId,
        }).execute();
        await trx.insertInto('outcome_checkins').values({ application_id: appId, ask_on: dayAfter(CHECKIN_AFTER_DAYS) }).onConflict((oc) => oc.doNothing()).execute();
      });
      return 'sent';
    } catch (e) {
      // Give the limits back, then retry later or give up.
      await this.db.asEngine(async (trx) => {
        await trx.updateTable('jobs').set({ autopilot_sent: sql`greatest(autopilot_sent - 1, 0)` }).where('id', '=', a.job_id).execute();
        for (const [scope, key] of [['user', a.user_id], ['employer', a.employer_key ?? a.apply_email!.split('@')[1]], ['domain', a.relay_domain]] as const) {
          await sql`UPDATE send_counters SET count = greatest(count - 1, 0) WHERE scope = ${scope}::send_scope AND scope_key = ${key} AND day = (now() AT TIME ZONE 'UTC')::date`.execute(trx);
        }
      });
      const attempts = (await this.load(appId))?.send_attempts ?? MAX_SEND_ATTEMPTS;
      const msg = (e as Error).message.slice(0, 300);
      this.logger.warn(`application ${appId}: ${msg}`);
      if (attempts >= MAX_SEND_ATTEMPTS) {
        await this.finish(appId, 'failed', `send_error: ${msg}`);
        return 'failed';
      }
      await this.db.asEngine((trx) => trx.updateTable('applications').set({ status: 'scheduled', scheduled_for: sql`now() + interval '30 minutes'`, failed_reason: msg }).where('id', '=', appId).execute());
      return 'rescheduled';
    }
  }

  /** The AI paragraph, only if it passes the claim check. Without budget or on doubt: the template alone. */
  private async paragraph(appId: string, a: Applicant, j: JobForLetter): Promise<string | null> {
    if (!this.ai.enabled) return null;
    try {
      const r = await this.ai.run({ task: 'app_paragraph', ...paragraphPrompt(a, j), schema: AppParagraph, subject: { type: 'application', id: appId } });
      const check = checkClaims(r.data.paragraph, a, j);
      if (!check.ok) {
        this.logger.log(`application ${appId}: paragraph dropped (${check.problems.join('; ')})`);
        return null;
      }
      return r.data.paragraph;
    } catch (e) {
      if (e instanceof AiBudgetExhausted || e instanceof AiRateLimited || e instanceof AiBadOutput) return null;
      throw e;
    }
  }

  async applicant(userId: string): Promise<Applicant> {
    const r = await this.db.asEngine((trx) =>
      trx
        .selectFrom('users as u')
        .innerJoin('profiles as p', 'p.user_id', 'u.id')
        .select(['u.full_name', 'p.city', 'p.country', 'p.headline', 'p.summary', 'p.years_experience', 'p.skills', 'p.experience', 'p.links'])
        .where('u.id', '=', userId)
        .executeTakeFirstOrThrow(),
    );
    return {
      fullName: r.full_name ?? 'Applicant',
      city: r.city,
      country: r.country,
      headline: r.headline,
      summary: r.summary,
      years: r.years_experience === null ? null : Number(r.years_experience),
      skills: r.skills ?? [],
      experience: (r.experience ?? []) as Applicant['experience'],
      links: (r.links ?? []) as string[],
    };
  }

  private async load(appId: string) {
    return this.db.asEngine((trx) =>
      trx
        .selectFrom('applications as a')
        .innerJoin('jobs as j', 'j.id', 'a.job_id')
        .innerJoin('users as u', 'u.id', 'a.user_id')
        .innerJoin('relay_addresses as ra', 'ra.id', 'a.relay_address_id')
        .innerJoin('sending_domains as d', 'd.domain', 'ra.domain')
        .leftJoin('autopilot_rules as r', 'r.user_id', 'a.user_id')
        .leftJoin('profiles as p', 'p.user_id', 'a.user_id')
        .select([
          'a.id', 'a.status', 'a.mode', 'a.user_id', 'a.job_id', 'a.employer_key', 'a.send_attempts', 'a.relay_address_id',
          'j.status as job_status', 'j.title', 'j.company_name', 'j.description', 'j.skills', 'j.apply_email',
          'u.status as user_status', 'r.enabled as rules_enabled', 'r.daily_cap', 'p.cv_file_key',
          sql<string>`ra.local_part || '@' || ra.domain`.as('relay_address'), 'ra.domain as relay_domain', 'd.daily_limit as domain_limit', 'd.paused as domain_paused',
          sql<boolean>`EXISTS (SELECT 1 FROM current_consents c WHERE c.user_id = a.user_id AND c.purpose = 'autopilot' AND c.granted)`.as('autopilot_consent'),
        ])
        .where('a.id', '=', appId)
        .executeTakeFirst(),
    );
  }

  private suppressed(address: string) {
    return this.db.asEngine((trx) => trx.selectFrom('email_suppressions').select('address').where('address', '=', address).executeTakeFirst()).then((r) => !!r);
  }

  private finish(appId: string, status: 'failed' | 'cancelled', reason: string) {
    return this.db.asEngine((trx) =>
      trx.updateTable('applications').set({ status, failed_reason: reason, ...(status === 'cancelled' ? { cancelled_at: sql`now()` } : {}) }).where('id', '=', appId).execute(),
    );
  }

  private backToQueue(userId: string, jobId: string, reason: 'outside_rules' | 'job_cap_reached') {
    return this.db.asEngine((trx) => trx.updateTable('matches').set({ status: 'in_queue', queue_reason: reason }).where('user_id', '=', userId).where('job_id', '=', jobId).execute());
  }
}

/** 08:00 in Lagos (07:00 UTC) tomorrow, with a few minutes' spread. */
export function tomorrowMorning(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 7, Math.floor(Math.random() * 30)));
}

function dayAfter(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

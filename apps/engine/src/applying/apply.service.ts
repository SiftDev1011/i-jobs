import { Injectable, Logger } from '@nestjs/common';
import { ExpressionBuilder, sql } from 'kysely';
import { AccessService } from '../account/access.service';
import { AiBadOutput, AiBudgetExhausted, AiRateLimited, AiService, nextUtcMidnight } from '../ai/ai.service';
import { ApplyPackAnswers, applyPackPrompt } from '../ai/prompts';
import { decodeCursor, page } from '../common/cursor';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { DB } from '../db/schema';
import { Kysely } from 'kysely';
import { JobsService } from '../jobs/jobs.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { StorageService } from '../storage/storage.service';
import { Applicant, checkClaims } from './compose';
import { CHECKIN_AFTER_DAYS, SenderService } from './sender.service';

const QUEUE_WARNINGS: Record<string, string | null> = {
  unverified_employer: "We couldn't confirm this employer. Check the company before you apply.",
  apply_on_source_site: null,
  outside_rules: null,
  autopilot_off: null,
  job_cap_reached: 'Many members have already applied to this one through autopilot.',
};
const CHECKIN_ANSWER_STATUS: Record<string, string | null> = {
  heard_back: 'replied', interview: 'interview', rejected: 'rejected', hired: 'hired', no_reply_yet: null, did_not_apply: 'cancelled',
};
const RANK: Record<string, number> = { scheduled: 0, sending: 0, sent: 1, no_response: 1, replied: 2, interview: 3, offer: 4, hired: 5, rejected: 6, cancelled: 7, failed: 7 };
const NO_RESPONSE_AFTER_DAYS = 30;

/**
 * Whose applications, seen from where. On i-jobs a member sees all their own applications; through a
 * partner site's key, only that site's (row-level security enforces it).
 */
export interface Who {
  userId: string;
  siteId: string;
  partner: boolean;
}

/** The apply queue, apply packs, the member's applications and check-ins. */
@Injectable()
export class ApplyService {
  private readonly logger = new Logger('Apply');

  constructor(
    private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly access: AccessService,
    private readonly ai: AiService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly sender: SenderService,
  ) {}

  // ---------------------------------------------------------------- apply queue

  async queue(userId: string, siteId: string, cursor: string | undefined, limit: number) {
    await this.access.assertJobFeatures(userId, siteId);
    const after = decodeCursor(cursor);
    let q = this.jobs
      .base()
      .innerJoin('matches as m', (j) => j.onRef('m.job_id', '=', 'j.id').on('m.user_id', '=', userId))
      .leftJoin('apply_packs as p', (j) => j.onRef('p.job_id', '=', 'j.id').on('p.user_id', '=', userId))
      .select(['m.score as match_score', 'm.queue_reason', 'p.generated_at as pack_at', sql<string>`m.computed_at`.as('queued_at')])
      .where('j.status', '=', 'live')
      .where('m.status', '=', 'in_queue');
    if (after) {
      q = q.where((eb: ExpressionBuilder<any, any>) => eb.or([eb('m.computed_at', '<', after.at), eb.and([eb('m.computed_at', '=', after.at), eb('j.id', '<', after.id)])]));
    }
    const rows = await q.orderBy('m.computed_at', 'desc').orderBy('j.id', 'desc').limit(limit + 1).execute();
    const p = page(rows, limit, (r: any) => ({ at: new Date(r.queued_at).toISOString(), id: r.id }));
    return {
      items: p.items.map((r: any) => ({
        job: this.jobs.summary(r),
        score: r.match_score,
        why_in_queue: r.queue_reason ?? 'outside_rules',
        warning: QUEUE_WARNINGS[r.queue_reason ?? ''] ?? null,
        pack_ready: !!r.pack_at,
      })),
      next_cursor: p.next_cursor,
    };
  }

  /** The pack if it exists; otherwise make it (AI when available, a profile-only pack when not). */
  async pack(userId: string, siteId: string, jobId: string): Promise<{ status: 200 | 202; body: unknown }> {
    await this.access.assertJobFeatures(userId, siteId);
    const job = await this.jobForPack(jobId);
    const existing = await this.db.k.selectFrom('apply_packs').selectAll().where('user_id', '=', userId).where('job_id', '=', jobId).executeTakeFirst();
    if (existing) return { status: 200, body: await this.packView(userId, job, existing) };

    if (!this.ai.enabled) {
      const pack = await this.savePack(userId, jobId, this.profileAnswers(await this.sender.applicant(userId), job), null);
      return { status: 200, body: await this.packView(userId, job, pack) };
    }
    const budget = await this.db.k.selectFrom('ai_budget_today').select('remaining_tokens').where('task', '=', 'apply_pack').executeTakeFirst();
    const est = await this.db.k.selectFrom('ai_task_budgets').select('est_tokens_per_call').where('task', '=', 'apply_pack').executeTakeFirst();
    const wait = Number(budget?.remaining_tokens ?? 0) < Number(est?.est_tokens_per_call ?? 0);
    const work = await this.db.asEngine((trx) =>
      trx.insertInto('work_items').values({
        kind: 'apply_pack', status: wait ? 'scheduled' : 'queued', user_id: userId, site_id: siteId,
        input: JSON.stringify({ job_id: jobId }), scheduled_for: wait ? nextUtcMidnight() : null,
      }).returning(['id', 'kind', 'status', 'scheduled_for']).executeTakeFirstOrThrow(),
    );
    await this.queues.add(QUEUES.ai, 'apply_pack', { workId: work.id }, { jobId: `apply_pack-${work.id}`, delay: wait ? nextUtcMidnight().getTime() - Date.now() : 0, attempts: 3 });
    return {
      status: 202,
      body: { work_id: work.id, kind: work.kind, status: work.status, scheduled_for: wait ? nextUtcMidnight().toISOString() : null, reason: wait ? 'daily_ai_budget' : null },
    };
  }

  /** Worker: write the AI pack. Answers that fail the claim check are replaced by profile-only ones. */
  async buildPack(workId: string): Promise<'done' | 'scheduled' | 'skipped'> {
    const work = await this.db.asEngine((trx) => trx.selectFrom('work_items').selectAll().where('id', '=', workId).executeTakeFirst());
    if (!work || work.status === 'done') return 'skipped';
    const { job_id } = work.input as { job_id: string };
    const userId = work.user_id!;
    const job = await this.jobForPack(job_id);
    const applicant = await this.sender.applicant(userId);
    let answers = this.profileAnswers(applicant, job);
    let model: string | null = null;
    try {
      const r = await this.ai.run({ task: 'apply_pack', ...applyPackPrompt(factsOf(applicant), { title: job.title, company: job.company_name, description: job.description }), schema: ApplyPackAnswers, subject: { type: 'work_item', id: workId } });
      const checked = r.data.answers.filter((a) => checkClaims(a.draft, applicant, { title: job.title, company: job.company_name, description: job.description, skills: job.skills ?? [] }).ok);
      if (checked.length) {
        answers = checked;
        model = r.model;
      }
    } catch (e) {
      if (e instanceof AiBudgetExhausted || e instanceof AiRateLimited) {
        const at = e instanceof AiBudgetExhausted ? e.resumeAt : new Date(Date.now() + e.retryAfterSeconds * 1000);
        await this.db.asEngine((trx) => trx.updateTable('work_items').set({ status: 'scheduled', scheduled_for: at }).where('id', '=', workId).execute());
        await this.queues.add(QUEUES.ai, 'apply_pack', { workId }, { jobId: `apply_pack-${workId}-${at.getTime()}`, delay: Math.max(0, at.getTime() - Date.now()) });
        return 'scheduled';
      }
      if (!(e instanceof AiBadOutput)) throw e;
    }
    await this.savePack(userId, job_id, answers, model);
    await this.db.asEngine(async (trx) => {
      await trx.updateTable('work_items').set({ status: 'done', result: JSON.stringify({ answers: answers.length }) }).where('id', '=', workId).execute();
      await trx.insertInto('notifications').values({ user_id: userId, site_id: work.site_id!, type: 'pack.ready', title: 'Your apply pack is ready', body: `For ${job.title} at ${job.company_name}.`, data: JSON.stringify({ job_id }) }).execute();
    });
    return 'done';
  }

  async markApplied(who: Who, jobId: string) {
    const { userId, siteId } = who;
    await this.access.assertJobFeatures(userId, siteId);
    const job = await this.db.k.selectFrom('jobs').select(['id', 'status']).where('id', '=', jobId).executeTakeFirst();
    if (!job) throw Problem.notFound('job_not_found', 'There is no job here');
    const match = await this.db.k.selectFrom('matches').select('score').where('user_id', '=', userId).where('job_id', '=', jobId).executeTakeFirst();
    const app = await this.db.asEngine(async (trx) => {
      const row = await trx
        .insertInto('applications')
        .values({ user_id: userId, job_id: jobId, site_id: siteId, mode: 'apply_queue', channel: 'external', status: 'sent', sent_at: sql`now()`, match_score: match?.score ?? null })
        .onConflict((oc) => oc.constraint('applications_once_per_job').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) throw Problem.conflict('already_applied', 'You have already applied to this job');
      await trx.insertInto('outcome_checkins').values({ application_id: row.id, ask_on: dayAfter(CHECKIN_AFTER_DAYS) }).execute();
      await trx.updateTable('matches').set({ status: 'applied', queue_reason: null }).where('user_id', '=', userId).where('job_id', '=', jobId).execute();
      return row;
    });
    return this.one(who, app.id);
  }

  // ---------------------------------------------------------------- applications

  async list(who: Who, f: { status?: string[]; cursor?: string; limit: number }) {
    return this.scoped(who, (k) => this.listIn(k, who.userId, f));
  }

  private async listIn(k: Kysely<DB>, userId: string, f: { status?: string[]; cursor?: string; limit: number }) {
    const after = decodeCursor(f.cursor);
    let q = this.appQuery(k, userId);
    if (f.status?.length) q = q.where('a.status', 'in', f.status as never[]);
    if (after) {
      q = q.where((eb: ExpressionBuilder<any, any>) => eb.or([eb('a.created_at', '<', after.at), eb.and([eb('a.created_at', '=', after.at), eb('a.id', '<', after.id)])]));
    }
    const [rows, totals] = await Promise.all([
      q.orderBy('a.created_at', 'desc').orderBy('a.id', 'desc').limit(f.limit + 1).execute(),
      k
        .selectFrom('applications')
        .select([
          sql<number>`count(*) FILTER (WHERE status NOT IN ('scheduled', 'sending', 'cancelled', 'failed'))::int`.as('sent'),
          sql<number>`count(*) FILTER (WHERE last_reply_class IS NOT NULL AND last_reply_class <> 'auto_reply' OR status IN ('replied', 'interview', 'offer', 'hired', 'rejected'))::int`.as('replies'),
          sql<number>`count(*) FILTER (WHERE status IN ('interview', 'offer', 'hired'))::int`.as('interviews'),
          sql<number>`count(*) FILTER (WHERE status IN ('offer', 'hired'))::int`.as('offers'),
          sql<number>`count(*) FILTER (WHERE status = 'scheduled')::int`.as('scheduled'),
        ])
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow(),
    ]);
    const inQueue = await this.db.k.selectFrom('matches').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('status', '=', 'in_queue').executeTakeFirstOrThrow();
    const p = page(rows, f.limit, (r: any) => ({ at: new Date(r.app_created_at).toISOString(), id: r.app_id }));
    return { totals: { ...totals, in_queue: inQueue.n }, items: p.items.map((r) => this.appView(r)), next_cursor: p.next_cursor };
  }

  async summary(who: Who, date?: string) {
    return this.scoped(who, (k) => this.summaryIn(k, who.userId, date));
  }

  private async summaryIn(k: Kysely<DB>, userId: string, date?: string) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const [sent, waiting, queued, replies] = await Promise.all([
      this.appQuery(k, userId).where('a.mode', '=', 'autopilot').where(sql<boolean>`(a.sent_at AT TIME ZONE 'UTC')::date = ${day}::date`).orderBy('a.sent_at', 'desc').execute(),
      k.selectFrom('applications').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('status', '=', 'scheduled').where(sql<boolean>`(scheduled_for AT TIME ZONE 'UTC')::date > ${day}::date`).executeTakeFirstOrThrow(),
      this.db.k.selectFrom('matches').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('status', '=', 'in_queue').where(sql<boolean>`(computed_at AT TIME ZONE 'UTC')::date = ${day}::date`).executeTakeFirstOrThrow(),
      this.db.asEngine((trx) => trx.selectFrom('email_messages').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('direction', '=', 'inbound').where(sql<boolean>`(created_at AT TIME ZONE 'UTC')::date = ${day}::date`).executeTakeFirstOrThrow()),
    ]);
    return { date: day, sent: sent.map((r) => this.appView(r)), scheduled_for_tomorrow: waiting.n, new_in_queue: queued.n, replies: replies.n };
  }

  async one(who: Who, appId: string) {
    return this.scoped(who, (k) => this.oneIn(k, who.userId, appId));
  }

  private async oneIn(k: Kysely<DB>, userId: string, appId: string) {
    const row = await this.appQuery(k, userId).where('a.id', '=', appId).executeTakeFirst();
    if (!row) throw Problem.notFound('application_not_found', 'There is no application here');
    return this.appView(row);
  }

  async detail(who: Who, appId: string) {
    const base = await this.one(who, appId);
    const [content, events] = await Promise.all([
      this.db.asEngine((trx) => trx.selectFrom('applications').select('content').where('id', '=', appId).executeTakeFirstOrThrow()),
      this.db.k.selectFrom('application_events').select(['to_status', 'at']).where('application_id', '=', appId).orderBy('at').execute(),
    ]);
    const c = (content.content ?? {}) as Record<string, unknown>;
    return {
      ...base,
      sent_copy: Object.keys(c).length ? { to: c.to, from: c.from, subject: c.subject, body: c.body, attachments: c.attachments ?? [] } : null,
      events: events.map((e) => ({ status: e.to_status, at: new Date(e.at as unknown as string).toISOString() })),
    };
  }

  async cancel(who: Who, appId: string) {
    const userId = who.userId;
    await this.one(who, appId);
    const r = await this.db.asEngine((trx) =>
      trx
        .updateTable('applications')
        .set({ status: 'cancelled', cancelled_at: sql`now()` })
        .where('id', '=', appId)
        .where('user_id', '=', userId)
        .where('status', '=', 'scheduled')
        .where((eb) => eb.or([eb('cancel_until', 'is', null), eb('cancel_until', '>', sql<Date>`now()`)]))
        .returning('job_id')
        .executeTakeFirst(),
    );
    if (!r) throw Problem.conflict('cancel_window_closed', 'This application has already been sent');
    // Back to the queue, so the member can still apply themselves.
    await this.db.asEngine((trx) => trx.updateTable('matches').set({ status: 'in_queue', queue_reason: 'outside_rules' }).where('user_id', '=', userId).where('job_id', '=', r.job_id).execute());
    return this.one(who, appId);
  }

  async answerCheckin(who: Who, appId: string, checkinId: string, answer: string) {
    await this.one(who, appId);
    const app = (await this.db.asEngine((trx) => trx.selectFrom('applications').select(['id', 'status', 'mode']).where('id', '=', appId).where('user_id', '=', who.userId).executeTakeFirst()))!;
    if (answer === 'did_not_apply' && app.mode === 'autopilot') throw Problem.unprocessable('answer_not_possible', 'Autopilot sent this application for you');
    await this.db.asEngine(async (trx) => {
      const c = await trx.updateTable('outcome_checkins').set({ answer: answer as never, answered_at: sql`now()` }).where('id', '=', checkinId).where('application_id', '=', appId).returning('id').executeTakeFirst();
      if (!c) throw Problem.notFound('checkin_not_found', 'There is no check-in here');
      const target = CHECKIN_ANSWER_STATUS[answer];
      if (target && (RANK[target] ?? 0) > (RANK[app.status] ?? 0)) {
        await trx.updateTable('applications').set({ status: target as never }).where('id', '=', appId).execute();
      }
      if (answer === 'no_reply_yet') {
        await trx.insertInto('outcome_checkins').values({ application_id: appId, ask_on: dayAfter(14) }).onConflict((oc) => oc.doNothing()).execute();
      }
    });
    return this.one(who, appId);
  }

  /** Worker, daily: ask due check-ins; close applications with no word after 30 days. */
  async checkins(): Promise<{ asked: number; no_response: number }> {
    const due = await this.db.asEngine((trx) =>
      trx
        .selectFrom('outcome_checkins as c')
        .innerJoin('applications as a', 'a.id', 'c.application_id')
        .innerJoin('jobs as j', 'j.id', 'a.job_id')
        .select(['c.id', 'a.id as app_id', 'a.user_id', 'a.site_id', 'j.title', 'j.company_name'])
        .where('c.asked_at', 'is', null)
        .where('c.answer', 'is', null)
        .where('c.ask_on', '<=', sql<Date>`(now() AT TIME ZONE 'UTC')::date`)
        .where('a.status', 'in', ['sent', 'replied'])
        .limit(2000)
        .execute(),
    );
    for (const c of due) {
      await this.db.asEngine(async (trx) => {
        await trx.updateTable('outcome_checkins').set({ asked_at: sql`now()` }).where('id', '=', c.id).execute();
        await trx.insertInto('notifications').values({
          user_id: c.user_id, site_id: c.site_id, type: 'checkin', title: `Did you hear back from ${c.company_name}?`,
          body: `About ${c.title}. Your answer helps us find you better jobs.`, data: JSON.stringify({ application_id: c.app_id, checkin_id: c.id }),
        }).execute();
      });
    }
    const stale = await this.db.asEngine((trx) =>
      trx.updateTable('applications').set({ status: 'no_response' }).where('status', '=', 'sent').where('sent_at', '<', sql<Date>`now() - make_interval(days => ${NO_RESPONSE_AFTER_DAYS})`).where('last_reply_at', 'is', null).executeTakeFirst(),
    );
    return { asked: due.length, no_response: Number(stale.numUpdatedRows) };
  }

  // ---------------------------------------------------------------- internals

  /** Partner sites see their own site's rows (RLS); on i-jobs the member sees all of theirs. */
  private scoped<T>(who: Who, fn: (k: Kysely<DB>) => Promise<T>): Promise<T> {
    return who.partner ? this.db.forSite(who.siteId, (trx) => fn(trx)) : this.db.asEngine((trx) => fn(trx));
  }

  private appQuery(k: Kysely<DB>, userId: string) {
    return this.jobs
      .base({ visibleOnly: false, k })
      .innerJoin('applications as a', 'a.job_id', 'j.id')
      .leftJoin('outcome_checkins as oc', (j) => j.onRef('oc.application_id', '=', 'a.id').on('oc.asked_at', 'is not', null).on('oc.answer', 'is', null))
      .select([
        'a.id as app_id', 'a.mode', 'a.channel', 'a.status as app_status', 'a.scheduled_for', 'a.cancel_until', 'a.sent_at', 'a.last_reply_class',
        'a.last_reply_at', 'a.created_at as app_created_at', 'a.match_score', 'oc.id as checkin_id',
        sql<string>`j.company_name`.as('checkin_company'),
      ])
      .where('a.user_id', '=', userId);
  }

  private appView(r: any) {
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return {
      id: r.app_id,
      job: this.jobs.summary(r),
      mode: r.mode,
      channel: r.channel,
      status: r.app_status,
      scheduled_for: iso(r.scheduled_for),
      cancel_until: r.app_status === 'scheduled' ? iso(r.cancel_until) : null,
      sent_at: iso(r.sent_at),
      last_reply: r.last_reply_class,
      last_reply_at: iso(r.last_reply_at),
      open_checkin: r.checkin_id ? { id: r.checkin_id, question: `Did you hear back from ${r.checkin_company}?` } : null,
    };
  }

  private async jobForPack(jobId: string) {
    const job = await this.db.k
      .selectFrom('jobs as j')
      .innerJoin('job_sources as js', (j) => j.onRef('js.job_id', '=', 'j.id').on('js.is_primary', '=', true))
      .innerJoin('sources as s', 's.key', 'js.source_key')
      .select(['j.id', 'j.title', 'j.company_name', 'j.description', 'j.skills', 'j.status', 'j.apply_method', 'j.apply_url', 'j.apply_email', 'js.apply_url as source_apply_url', 's.apply_via_source_link'])
      .where('j.id', '=', jobId)
      .executeTakeFirst();
    if (!job) throw Problem.notFound('job_not_found', 'There is no job here');
    if (job.status !== 'live') throw new Problem(410, 'job_closed', 'This job has closed');
    return job;
  }

  private profileAnswers(a: Applicant, job: { title: string; company_name: string }) {
    const latest = a.experience.find((e) => e.title);
    const answers = [
      {
        question: `Why do you want to work as ${job.title} at ${job.company_name}?`,
        draft: `I'm ${a.headline ? `a ${a.headline.toLowerCase()}` : 'applying'} and this role fits the work I do best${a.skills.length ? `, especially ${a.skills.slice(0, 3).join(', ')}` : ''}. [Add one line on what draws you to ${job.company_name}.]`,
      },
    ];
    if (latest) {
      answers.push({
        question: 'Tell us about your most relevant experience.',
        draft: `Most recently I worked as ${latest.title}${latest.company ? ` at ${latest.company}` : ''}.${latest.highlights?.length ? ` ${latest.highlights.slice(0, 2).join('. ')}.` : ''}`,
      });
    }
    return answers;
  }

  private async savePack(userId: string, jobId: string, answers: { question: string; draft: string }[], model: string | null) {
    return this.db.asEngine((trx) =>
      trx
        .insertInto('apply_packs')
        .values({ user_id: userId, job_id: jobId, answers: JSON.stringify(answers), model_key: model })
        .onConflict((oc) => oc.columns(['user_id', 'job_id']).doUpdateSet({ answers: JSON.stringify(answers), model_key: model, generated_at: sql`now()` }))
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  private async packView(userId: string, job: Awaited<ReturnType<ApplyService['jobForPack']>>, pack: { answers: unknown; generated_at: unknown }) {
    const profile = await this.db.k.selectFrom('profiles').select('cv_file_key').where('user_id', '=', userId).executeTakeFirst();
    const openUrl = job.apply_via_source_link
      ? (job.source_apply_url ?? job.apply_url)
      : job.apply_method === 'email' && job.apply_email
        ? `mailto:${job.apply_email}?subject=${encodeURIComponent(`Application for ${job.title}`)}`
        : job.apply_url;
    return {
      job_id: job.id,
      // Their own CV for now; tailored versions are a later improvement.
      tailored_cv_url: profile?.cv_file_key ? await this.storage.downloadUrl(profile.cv_file_key, `CV.${profile.cv_file_key.split('.').pop()}`) : null,
      answers: pack.answers,
      open_url: openUrl,
      generated_at: new Date(pack.generated_at as string).toISOString(),
    };
  }
}

function factsOf(a: Applicant): string {
  return [
    a.headline && `Headline: ${a.headline}`,
    a.years !== null && `Years of experience: ${Math.round(a.years)}`,
    a.skills.length && `Skills: ${a.skills.join(', ')}`,
    ...a.experience.slice(0, 4).map((e) => `Role: ${[e.title, e.company && `at ${e.company}`].filter(Boolean).join(' ')}${e.highlights?.length ? `. ${e.highlights.join('. ')}` : ''}`),
    a.summary && `Summary: ${a.summary}`,
  ].filter(Boolean).join('\n');
}

function dayAfter(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

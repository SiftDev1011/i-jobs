import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, requireRole, userIdOf } from '../auth/actor';
import { Problem } from '../common/problem';
import { Uuid, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';
import { nextUtcMidnight, utcDay } from '../ai/ai.service';
import { JobsService } from './jobs.service';


const SourceRules = z
  .object({
    enabled: z.boolean(),
    display: z.enum(['full', 'job_finds_only', 'disabled']),
    terms_status: z.enum(['ok', 'needs_review', 'pending_reply', 'restricted', 'blocked']),
    allow_paywall: z.boolean(),
    allow_autopilot: z.boolean(),
    allow_signup_gate: z.boolean(),
    apply_via_source_link: z.boolean(),
    requires_credit: z.boolean(),
    credit_text: z.string().max(80).nullable(),
    fetch_interval_minutes: z.number().int().min(5).max(10080),
    max_fetches_per_day: z.number().int().positive().nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one rule');

const Takedown = z.object({ reason: z.enum(['scam', 'closed', 'terms', 'duplicate', 'other']) });

@Auth('staff')
@Controller('admin')
export class AdminJobsController {
  constructor(
    private readonly db: Db,
    private readonly jobs: JobsService,
  ) {}

  @Get('sources')
  async sources(@CurrentActor() actor: Actor) {
    requireRole(actor, ['admin', 'moderator']);
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('sources as s').leftJoin('source_health as h', 'h.key', 's.key').selectAll('s').select(['h.last_run_at', 'h.last_run_ok', 'h.jobs_live', 'h.failures_in_a_row']).orderBy('s.kind').orderBy('s.key').execute(),
    );
    return rows.map((r) => this.source(r));
  }

  @Patch('sources/:sourceKey')
  async updateSource(@CurrentActor() actor: Actor, @Param('sourceKey') key: string, @Body(new ZodPipe(SourceRules)) body: z.infer<typeof SourceRules>) {
    requireRole(actor, ['admin']);
    return this.db.asEngine(async (trx) => {
      const before = await trx.selectFrom('sources').selectAll().where('key', '=', key).executeTakeFirst();
      if (!before) throw Problem.notFound('source_not_found', 'There is no source with this key');
      await trx.updateTable('sources').set({ ...body, updated_at: sql`now()` }).where('key', '=', key).execute();
      const changed = Object.fromEntries(Object.keys(body).map((k) => [k, { from: (before as any)[k], to: (body as any)[k] }]));
      await trx.insertInto('audit_log').values({ actor_user_id: userIdOf(actor), actor_kind: 'staff', action: 'source.update', subject_type: 'source', meta: JSON.stringify({ key, changed }) }).execute();
      const row = await trx.selectFrom('sources as s').leftJoin('source_health as h', 'h.key', 's.key').selectAll('s').select(['h.last_run_at', 'h.last_run_ok', 'h.jobs_live', 'h.failures_in_a_row']).where('s.key', '=', key).executeTakeFirstOrThrow();
      return this.source(row);
    });
  }

  @Get('ai-budget')
  async aiBudget(@CurrentActor() actor: Actor) {
    requireRole(actor, ['admin']);
    const [tasks, waiting] = await Promise.all([
      this.db.k.selectFrom('ai_budget_today').selectAll().orderBy('task').execute(),
      this.db.asEngine((trx) => trx.selectFrom('ai_waiting').selectAll().execute()),
    ]);
    return {
      day: utcDay(),
      resets_at: nextUtcMidnight().toISOString().replace(/T00:05/, 'T00:00'),
      tasks: tasks.map((t) => ({
        task: t.task,
        model: t.model_key,
        daily_tokens: Number(t.daily_tokens),
        spent_tokens: Number(t.spent_tokens),
        remaining_tokens: Math.max(0, Number(t.remaining_tokens)),
        calls_left_estimate: Math.max(0, Number(t.calls_left_estimate)),
      })),
      waiting: Object.fromEntries(waiting.map((w) => [w.task, Number(w.waiting)])),
    };
  }

  @Post('jobs/:jobId/takedown')
  @HttpCode(204)
  async takedown(@CurrentActor() actor: Actor, @Param('jobId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(Takedown)) body: z.infer<typeof Takedown>) {
    requireRole(actor, ['admin', 'moderator']);
    await this.jobs.takedown(id, userIdOf(actor), body.reason);
  }

  private source(r: any) {
    return {
      key: r.key,
      name: r.name,
      kind: r.kind,
      terms_url: r.terms_url,
      enabled: r.enabled,
      display: r.display,
      terms_status: r.terms_status,
      allow_paywall: r.allow_paywall,
      allow_autopilot: r.allow_autopilot,
      allow_signup_gate: r.allow_signup_gate,
      apply_via_source_link: r.apply_via_source_link,
      requires_credit: r.requires_credit,
      credit_text: r.credit_text,
      fetch_interval_minutes: r.fetch_interval_minutes,
      max_fetches_per_day: r.max_fetches_per_day,
      notes: r.notes,
      health: {
        last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
        last_run_ok: r.last_run_ok ?? null,
        jobs_live: Number(r.jobs_live ?? 0),
        failures_in_a_row: Number(r.failures_in_a_row ?? 0),
      },
    };
  }
}

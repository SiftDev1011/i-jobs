import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

export type AiTask = 'job_extract' | 'scam_check' | 'cv_parse' | 'app_paragraph' | 'reply_sort' | 'apply_pack' | 'support_answer';

/** Today's free tokens for this task are spent. The work waits for the next UTC day. */
export class AiBudgetExhausted extends Error {
  constructor(readonly task: AiTask, readonly resumeAt: Date) {
    super(`AI budget for ${task} is spent until ${resumeAt.toISOString()}`);
  }
}
/** Groq's per-minute limit, or no key configured. Try again shortly. */
export class AiRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number, reason = 'rate limited') {
    super(`AI ${reason}; retry in ${retryAfterSeconds}s`);
  }
}
/** The model answered with something we can't use. Not retried, to protect the budget. */
export class AiBadOutput extends Error {}

export interface AiRequest<T> {
  task: AiTask;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  subject?: { type: string; id: string };
}

export interface AiResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  callId: string;
}

export type ChatFn = (body: Record<string, unknown>) => Promise<{ status: number; headers: Headers; json: any }>;

/**
 * Every AI call goes through here: reserve tokens from the day's budget first
 * (ai_reserve picks the model, with fallback), respect Groq's per-minute limits,
 * call, then settle the real usage and log the call.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AI');
  private chatFn: ChatFn;
  private faked = false;

  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.chatFn = (body) => this.groq(body);
  }

  /** Tests replace Groq with a fake. */
  useChat(fn: ChatFn) {
    this.chatFn = fn;
    this.faked = true;
  }

  /** False until GROQ_API_KEY is set; AI work then waits instead of failing. */
  get enabled() {
    return !!this.config.GROQ_API_KEY || this.faked;
  }

  async run<T>(req: AiRequest<T>): Promise<AiResult<T>> {
    if (!this.enabled) throw new AiRateLimited(3600, 'has no GROQ_API_KEY');

    const est = estimateTokens(req.system) + estimateTokens(req.user) + req.maxOutputTokens;
    const day = utcDay();
    const modelKey = await this.db.asEngine(async (trx) => {
      const r = await sql<{ m: string | null }>`SELECT ai_reserve(${req.task}::ai_task, ${est}::integer, ${day}::date) AS m`.execute(trx);
      return r.rows[0]?.m ?? null;
    });
    if (!modelKey) throw new AiBudgetExhausted(req.task, nextUtcMidnight());

    const model = await this.db.k.selectFrom('ai_models').select(['model_name', 'tpm', 'rpm', 'safety_margin_pct']).where('key', '=', modelKey).executeTakeFirstOrThrow();
    const settle = (input: number, output: number, limited = false) =>
      this.db.asEngine((trx) =>
        sql`SELECT ai_settle(${day}::date, ${modelKey}, ${req.task}::ai_task, ${est}::integer, ${input}::integer, ${output}::integer, ${limited})`.execute(trx),
      );

    // Per-minute limits, shared by every worker through Redis.
    const minute = Math.floor(Date.now() / 60_000);
    const keep = (100 - model.safety_margin_pct) / 100;
    const [tokensUsed, callsUsed] = await Promise.all([
      this.redis.client.incrby(`ai:tpm:${modelKey}:${minute}`, est),
      this.redis.client.incr(`ai:rpm:${modelKey}:${minute}`),
    ]);
    await this.redis.client.expire(`ai:tpm:${modelKey}:${minute}`, 120);
    await this.redis.client.expire(`ai:rpm:${modelKey}:${minute}`, 120);
    if (tokensUsed > model.tpm * keep || callsUsed > model.rpm * keep) {
      await settle(0, 0);
      throw new AiRateLimited(61 - new Date().getUTCSeconds());
    }

    const started = Date.now();
    const body: Record<string, unknown> = {
      model: model.model_name,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: 0.2,
      max_completion_tokens: req.maxOutputTokens,
      response_format: { type: 'json_object' },
    };
    if (model.model_name.includes('gpt-oss')) body.reasoning_effort = 'low';

    let res: Awaited<ReturnType<ChatFn>>;
    try {
      res = await this.chatFn(body);
    } catch (e) {
      await settle(0, 0);
      await this.log(req, modelKey, day, est, 0, 0, Date.now() - started, 'error', (e as Error).message);
      throw e;
    }

    if (res.status === 429) {
      await settle(0, 0, true);
      await this.log(req, modelKey, day, est, 0, 0, Date.now() - started, 'rate_limited', JSON.stringify(res.json?.error ?? {}).slice(0, 300));
      const retry = Number(res.headers.get('retry-after')) || 60;
      throw new AiRateLimited(Math.min(Math.max(retry, 5), 3600));
    }
    const input = Number(res.json?.usage?.prompt_tokens ?? 0);
    const output = Number(res.json?.usage?.completion_tokens ?? 0);
    if (res.status >= 400) {
      await settle(input, output);
      await this.log(req, modelKey, day, est, input, output, Date.now() - started, 'error', `HTTP ${res.status} ${JSON.stringify(res.json?.error ?? {}).slice(0, 300)}`);
      if (res.status >= 500) throw new AiRateLimited(60, `server error ${res.status}`);
      throw new AiBadOutput(`Groq said ${res.status}`);
    }

    await settle(input, output);
    const content: string = res.json?.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      const id = await this.log(req, modelKey, day, est, input, output, Date.now() - started, 'error', `not JSON: ${content.slice(0, 200)}`);
      throw new AiBadOutput(`AI answer was not JSON (call ${id})`);
    }
    const checked = req.schema.safeParse(parsed);
    if (!checked.success) {
      const id = await this.log(req, modelKey, day, est, input, output, Date.now() - started, 'error', `schema: ${checked.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      throw new AiBadOutput(`AI answer did not match the expected shape (call ${id})`);
    }
    const callId = await this.log(req, modelKey, day, est, input, output, Date.now() - started, 'ok', null);
    return { data: checked.data, model: modelKey, inputTokens: input, outputTokens: output, callId };
  }

  private async log(req: AiRequest<unknown>, model: string, day: string, reserved: number, input: number, output: number, ms: number, status: 'ok' | 'rate_limited' | 'error', error: string | null) {
    const row = await this.db.asEngine((trx) =>
      trx
        .insertInto('ai_calls')
        .values({
          day, task: req.task, model_key: model, subject_type: req.subject?.type ?? null, subject_id: req.subject?.id ?? null,
          reserved_tokens: reserved, input_tokens: input, output_tokens: output, latency_ms: ms, status, error,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    if (status !== 'ok') this.logger.warn(`${req.task} on ${model}: ${status}${error ? ` (${error})` : ''}`);
    return row.id;
  }

  private async groq(body: Record<string, unknown>) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.AI_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: { message: text.slice(0, 300) } };
      }
      return { status: res.status, headers: res.headers, json };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Rough count, on the safe side: about 3.5 characters a token for English. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5) + 8;
}

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function nextUtcMidnight(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5));
}

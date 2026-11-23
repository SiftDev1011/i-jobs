import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { AiBadOutput, AiBudgetExhausted, AiRateLimited, AiService } from '../ai/ai.service';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { truncate } from '../ingest/text';
import { EmbeddingService, toVector } from '../matching/embedding.service';

/** Questions a bot must never answer: money, scams, personal data and complaints go to a person. */
const SENSITIVE = /\b(refund|charged|charge|payment|paid|pay|money|debit|scam|fraud|fake|stole|data|delete my|privacy|complain|complaint|lawyer|police|harass|abuse)\b/i;
const FAQ_GOOD = 0.35;

const SupportAnswer = z.object({ answer: z.string().trim().max(1200), confident: z.boolean() });

/** Help search, the support assistant and tickets. */
@Injectable()
export class SupportService {
  constructor(
    private readonly db: Db,
    private readonly ai: AiService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /** By meaning when embeddings are set up, otherwise by words. No AI call either way. */
  async search(siteId: string, q: string, limit = 5) {
    if (this.embeddings.enabled) {
      try {
        await this.embedMissing();
        const [v] = await this.embeddings.embed([q], 'query');
        const rows = await sql<{ id: string; question: string; answer: string; relevance: number }>`
          SELECT id, question, answer, 1 - (embedding <=> ${toVector(v)}::vector) AS relevance FROM faq_articles
           WHERE published AND embedding IS NOT NULL AND (site_id IS NULL OR site_id = ${siteId})
           ORDER BY embedding <=> ${toVector(v)}::vector LIMIT ${limit}`.execute(this.db.k);
        if (rows.rows.length) return rows.rows.map((r) => ({ ...r, relevance: Math.max(0, Math.min(1, Number(r.relevance))) }));
      } catch {
        /* fall back to words */
      }
    }
    const rows = await sql<{ id: string; question: string; answer: string; rank: number }>`
      SELECT id, question, answer, ts_rank_cd(search, websearch_to_tsquery('english', ${q}), 32) + 0.3 * similarity(question, ${q}) AS rank
        FROM faq_articles
       WHERE published AND (site_id IS NULL OR site_id = ${siteId})
         AND (search @@ websearch_to_tsquery('english', ${q}) OR similarity(question, ${q}) > 0.2
              OR search @@ to_tsquery('english', ${orTerms(q)}))
       ORDER BY rank DESC LIMIT ${limit}`.execute(this.db.k);
    return rows.rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer, relevance: Math.round(Math.min(1, Number(r.rank) * 2) * 100) / 100 }));
  }

  async ask(userId: string, siteId: string, question: string): Promise<{ status: 200 | 202; body: unknown }> {
    if (SENSITIVE.test(question)) {
      const t = await this.createTicket(userId, siteId, { subject: truncate(question, 80), category: categoryOf(question), message: question }, 'waiting_human');
      return { status: 202, body: { work_id: t.id, kind: 'support_answer', status: 'queued', scheduled_for: null, reason: 'handed_to_person', ticket_id: t.id } };
    }
    const hits = await this.search(siteId, question, 3);
    if (hits[0] && hits[0].relevance >= FAQ_GOOD) return { status: 200, body: { answer: hits[0].answer, source: 'faq', ticket_id: null } };

    if (this.ai.enabled) {
      try {
        const context = hits.map((h, i) => `[${i + 1}] Q: ${h.question}\nA: ${h.answer}`).join('\n\n') || '(no help articles matched)';
        const r = await this.ai.run({
          task: 'support_answer',
          system: [
            'You answer questions from members of i-jobs, a job-matching service, using ONLY the help articles given.',
            'If the articles do not answer the question, set confident to false and do not guess.',
            'Never discuss prices, payments, refunds or personal data. Return JSON: {"answer": "...", "confident": true|false}. Plain English, under 120 words.',
          ].join('\n'),
          user: `HELP ARTICLES:\n${context}\n\nQUESTION: ${question}`,
          schema: SupportAnswer,
          maxOutputTokens: 600,
        });
        if (r.data.confident && r.data.answer) return { status: 200, body: { answer: r.data.answer, source: 'assistant', ticket_id: null } };
      } catch (e) {
        if (!(e instanceof AiBudgetExhausted || e instanceof AiRateLimited || e instanceof AiBadOutput)) throw e;
      }
    }
    const t = await this.createTicket(userId, siteId, { subject: truncate(question, 80), category: 'other', message: question }, 'waiting_human');
    return { status: 202, body: { work_id: t.id, kind: 'support_answer', status: 'queued', scheduled_for: null, reason: 'handed_to_person', ticket_id: t.id } };
  }

  async createTicket(userId: string, siteId: string, t: { subject: string; category?: string; message: string }, status: 'open' | 'waiting_human' = 'waiting_human') {
    const row = await this.db.asEngine(async (trx) => {
      const ticket = await trx.insertInto('support_tickets').values({ user_id: userId, site_id: siteId, subject: t.subject, category: t.category ?? 'other', status, escalated_at: status === 'waiting_human' ? sql`now()` : null }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('support_messages').values({ ticket_id: ticket.id, author: 'user', body: t.message }).execute();
      return ticket;
    });
    return this.ticket(userId, row.id);
  }

  async ticket(userId: string | null, ticketId: string) {
    const t = await this.db.asEngine((trx) => trx.selectFrom('support_tickets').selectAll().where('id', '=', ticketId).$if(userId !== null, (q) => q.where('user_id', '=', userId!)).executeTakeFirst());
    if (!t) throw Problem.notFound('ticket_not_found', 'There is no ticket here');
    const messages = await this.db.asEngine((trx) => trx.selectFrom('support_messages').select(['author', 'body', 'at']).where('ticket_id', '=', ticketId).orderBy('at').orderBy('id').execute());
    return {
      id: t.id, subject: t.subject, category: t.category, status: t.status,
      messages: messages.map((m) => ({ author: m.author, body: m.body, at: new Date(m.at as unknown as string).toISOString() })),
      created_at: new Date(t.created_at as unknown as string).toISOString(),
    };
  }

  /** The member's own tickets, newest first. */
  async mine(userId: string) {
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('support_tickets').select(['id', 'subject', 'category', 'status', 'created_at']).where('user_id', '=', userId).orderBy('created_at', 'desc').limit(100).execute(),
    );
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at as unknown as string).toISOString() }));
  }

  async reply(userId: string, ticketId: string, body: string) {
    await this.ticket(userId, ticketId);
    await this.db.asEngine(async (trx) => {
      await trx.insertInto('support_messages').values({ ticket_id: ticketId, author: 'user', body }).execute();
      await trx.updateTable('support_tickets').set({ status: 'waiting_human', resolved_at: null }).where('id', '=', ticketId).execute();
    });
  }

  // ---------------------------------------------------------------- staff

  async staffList(status?: string) {
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('support_tickets').select(['id', 'subject', 'category', 'status', 'created_at', 'site_id']).$if(!!status, (q) => q.where('status', '=', status as never)).$if(!status, (q) => q.where('status', '!=', 'resolved'))
        .orderBy('created_at').limit(500).execute(),
    );
    return { items: rows.map((r) => ({ ...r, created_at: new Date(r.created_at as unknown as string).toISOString() })), next_cursor: null };
  }

  async staffReply(staffId: string, ticketId: string, body: string, resolve: boolean) {
    const t = await this.db.asEngine(async (trx) => {
      const t = await trx.selectFrom('support_tickets as t').leftJoin('users as u', 'u.id', 't.user_id').select(['t.id', 't.subject', 't.user_id', 't.site_id', 'u.email']).where('t.id', '=', ticketId).executeTakeFirst();
      if (!t) throw Problem.notFound('ticket_not_found', 'There is no ticket here');
      await trx.insertInto('support_messages').values({ ticket_id: ticketId, author: 'staff', body }).execute();
      await trx.updateTable('support_tickets').set({ status: resolve ? 'resolved' : 'open', assigned_to: staffId, resolved_at: resolve ? sql`now()` : null }).where('id', '=', ticketId).execute();
      if (t.user_id) {
        await trx.insertInto('notifications').values({ user_id: t.user_id, site_id: t.site_id, type: 'support.reply', title: `Reply about: ${t.subject}`, body: truncate(body, 600), data: JSON.stringify({ ticket_id: ticketId }) }).execute();
      }
      return t;
    });
    return this.ticket(null, t.id);
  }

  /** Embed help articles that don't have a vector yet (a handful; cheap). */
  private async embedMissing() {
    const rows = await this.db.asEngine((trx) => trx.selectFrom('faq_articles').select(['id', 'question', 'answer']).where('embedding', 'is', null).limit(64).execute());
    if (!rows.length) return;
    const vectors = await this.embeddings.embed(rows.map((r) => `${r.question}\n${r.answer}`), 'document');
    await this.db.asEngine(async (trx) => {
      for (let i = 0; i < rows.length; i++) await trx.updateTable('faq_articles').set({ embedding: toVector(vectors[i]) }).where('id', '=', rows[i].id).execute();
    });
  }
}

function orTerms(q: string) {
  const words = q.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return words.length ? words.slice(0, 12).map((w) => `${w}:*`).join(' | ') : 'zzzznomatch';
}

function categoryOf(q: string) {
  if (/\b(refund|charged|charge|payment|paid|pay|money|debit)\b/i.test(q)) return 'payment';
  if (/\b(scam|fraud|fake|stole)\b/i.test(q)) return 'scam_report';
  if (/\b(data|delete my|privacy)\b/i.test(q)) return 'data_request';
  return 'other';
}

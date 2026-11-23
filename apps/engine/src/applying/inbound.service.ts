import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AiBadOutput, AiBudgetExhausted, AiRateLimited, AiService } from '../ai/ai.service';
import { ReplySort, replySortPrompt } from '../ai/prompts';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { nextStatus, ReplyClass, sortByRules, textFromRaw, withoutQuotes } from './replies';

export interface InboundEmail {
  to: string;
  from: string;
  subject?: string;
  message_id?: string;
  in_reply_to?: string;
  raw_key: string;
  text?: string;
}

const LABEL: Record<ReplyClass, string> = {
  interview: 'wants to talk to you',
  rejection: 'replied about your application',
  info_request: 'asked for more information',
  auto_reply: 'sent an automatic reply',
  other: 'replied',
};

/** Replies to relay addresses, and SES bounce and complaint notices. */
@Injectable()
export class InboundService {
  private readonly logger = new Logger('Inbound');

  constructor(
    private readonly db: Db,
    private readonly ai: AiService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly redis: RedisService,
  ) {}

  /** Match a reply to the member and, if we can, the application. Sorting happens in the worker. */
  async receive(m: InboundEmail): Promise<{ stored: boolean }> {
    const [local, domain] = m.to.toLowerCase().trim().split('@');
    const relay = await this.db.asEngine((trx) =>
      trx.selectFrom('relay_addresses').select(['id', 'user_id', 'active']).where('local_part', '=', local).where('domain', '=', domain ?? '').executeTakeFirst(),
    );
    if (!relay || !relay.active) {
      this.logger.warn(`Reply to unknown relay address ${m.to}`);
      return { stored: false };
    }
    if (m.message_id) {
      const dup = await this.db.asEngine((trx) => trx.selectFrom('email_messages').select('id').where('provider_message_id', '=', m.message_id!).executeTakeFirst());
      if (dup) return { stored: true };
    }

    // The thread it answers, else the latest application to the sender's domain, else the latest one sent.
    const fromDomain = m.from.toLowerCase().split('@')[1] ?? '';
    const byThread = m.in_reply_to
      ? await this.db.asEngine((trx) => trx.selectFrom('email_messages').select('application_id').where('provider_message_id', '=', m.in_reply_to!.replace(/^<|>$/g, '')).executeTakeFirst())
      : undefined;
    const byDomain = byThread?.application_id
      ? null
      : await this.db.asEngine((trx) =>
          trx.selectFrom('applications').select('id').where('user_id', '=', relay.user_id).where('relay_address_id', '=', relay.id).where('employer_key', '=', fromDomain).where('sent_at', 'is not', null).orderBy('sent_at', 'desc').executeTakeFirst(),
        );
    const applicationId = byThread?.application_id ?? byDomain?.id ?? null;

    const row = await this.db.asEngine((trx) =>
      trx
        .insertInto('email_messages')
        .values({
          direction: 'inbound', user_id: relay.user_id, application_id: applicationId, relay_address_id: relay.id,
          from_addr: m.from, to_addr: m.to, subject: m.subject?.slice(0, 500) ?? null, raw_key: m.raw_key,
          provider_message_id: m.message_id ?? null, in_reply_to: m.in_reply_to ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    if (m.text) await this.redis.client.set(`inbound-text:${row.id}`, m.text.slice(0, 20000), 'EX', 86400);
    await this.queues.add(QUEUES.ai, 'reply_sort', { messageId: row.id }, { jobId: `reply_sort-${row.id}`, attempts: 3 });
    return { stored: true };
  }

  /** Worker: sort, update the application, tell the member and pass the reply on. */
  async sort(messageId: string): Promise<ReplyClass | 'skipped'> {
    const msg = await this.db.asEngine((trx) =>
      trx
        .selectFrom('email_messages as e')
        .innerJoin('users as u', 'u.id', 'e.user_id')
        .leftJoin('applications as a', 'a.id', 'e.application_id')
        .leftJoin('jobs as j', 'j.id', 'a.job_id')
        .select(['e.id', 'e.from_addr', 'e.subject', 'e.raw_key', 'e.classification', 'e.user_id', 'e.application_id', 'u.email', 'u.full_name', 'a.status as app_status', 'a.site_id', 'j.title', 'j.company_name'])
        .where('e.id', '=', messageId)
        .executeTakeFirst(),
    );
    if (!msg || msg.classification) return 'skipped';

    const cached = await this.redis.client.get(`inbound-text:${messageId}`);
    const text = cached ? withoutQuotes(cached) : msg.raw_key ? textFromRaw((await this.storage.get(msg.raw_key, 10 * 1024 * 1024)).toString('utf8')) : '';
    const subject = msg.subject ?? '';

    let cls: ReplyClass = sortByRules(subject, text) ?? 'other';
    if (cls === 'other' && this.ai.enabled && text.length > 20) {
      try {
        cls = (await this.ai.run({ task: 'reply_sort', ...replySortPrompt(subject, text), schema: ReplySort, subject: { type: 'email_message', id: messageId } })).data.class;
      } catch (e) {
        if (!(e instanceof AiBudgetExhausted || e instanceof AiRateLimited || e instanceof AiBadOutput)) throw e;
      }
    }

    await this.db.asEngine(async (trx) => {
      await trx.updateTable('email_messages').set({ classification: cls, classified_at: sql`now()` }).where('id', '=', messageId).execute();
      if (!msg.application_id) return;
      const status = nextStatus(msg.app_status ?? 'sent', cls);
      await trx
        .updateTable('applications')
        .set({ last_reply_class: cls, last_reply_at: sql`now()`, ...(status ? { status: status as never } : {}) })
        .where('id', '=', msg.application_id)
        .execute();
      if (cls !== 'auto_reply') {
        await trx.updateTable('outcome_checkins').set({ answer: cls === 'interview' ? 'interview' : cls === 'rejection' ? 'rejected' : 'heard_back', answered_at: sql`now()` }).where('application_id', '=', msg.application_id).where('answer', 'is', null).execute();
        await trx.insertInto('notifications').values({
          user_id: msg.user_id!, site_id: msg.site_id!, type: 'application.reply',
          title: `${msg.company_name ?? 'An employer'} ${LABEL[cls]}`,
          body: `About ${msg.title ?? 'your application'}. We've sent the reply to your email.`,
          data: JSON.stringify({ application_id: msg.application_id, class: cls }),
        }).execute();
      }
    });

    // Pass the reply on. Replying to it goes straight to the employer.
    if (msg.email && cls !== 'auto_reply') {
      await this.mail.send({
        to: msg.email,
        replyTo: msg.from_addr,
        subject: `${msg.company_name ?? 'An employer'} replied: ${subject || msg.title || 'your application'}`.slice(0, 200),
        text: [
          `${msg.company_name ?? 'An employer'} ${LABEL[cls]}${msg.title ? ` about ${msg.title}` : ''}.`,
          `From: ${msg.from_addr}`,
          '',
          text || '(The message had no text. Open it from your i-jobs applications.)',
          '',
          '—',
          'Reply to this email to answer the employer directly.',
        ].join('\n'),
      });
    }
    await this.redis.client.del(`inbound-text:${messageId}`);
    return cls;
  }

  /** One SES event (from SNS): permanent bounces and complaints suppress the address. */
  async sesEvent(event: any): Promise<string> {
    const type = event?.eventType ?? event?.notificationType;
    const sesId = event?.mail?.messageId as string | undefined;
    const addresses: string[] =
      type === 'Bounce' && event.bounce?.bounceType === 'Permanent'
        ? (event.bounce.bouncedRecipients ?? []).map((r: any) => r.emailAddress)
        : type === 'Complaint'
          ? (event.complaint?.complainedRecipients ?? []).map((r: any) => r.emailAddress)
          : [];
    if (!addresses.length) return 'ignored';

    await this.db.asEngine(async (trx) => {
      for (const address of addresses) {
        await trx.insertInto('email_suppressions').values({ address: address.toLowerCase(), reason: type === 'Bounce' ? 'bounce' : 'complaint' }).onConflict((oc) => oc.doNothing()).execute();
      }
      if (!sesId) return;
      const sent = await trx.selectFrom('email_messages').select(['application_id', 'user_id']).where('provider_message_id', '=', sesId).executeTakeFirst();
      if (sent?.application_id && type === 'Bounce') {
        await trx.updateTable('applications').set({ status: 'failed', failed_reason: 'employer_address_bounced' }).where('id', '=', sent.application_id).where('status', '=', 'sent').execute();
        if (sent.user_id) await trx.updateTable('users').set({ bounces_30d: sql`bounces_30d + 1` }).where('id', '=', sent.user_id).execute();
      }
    });
    return type === 'Bounce' ? 'bounce' : 'complaint';
  }
}

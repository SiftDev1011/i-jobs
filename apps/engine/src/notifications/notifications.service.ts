import { Inject, Injectable } from '@nestjs/common';
import { ExpressionBuilder, Kysely, sql } from 'kysely';
import { decodeCursor, page } from '../common/cursor';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { DB } from '../db/schema';
import { MailService } from '../messaging/mail.service';

/** Types worth an email as well as the in-app notice. Replies are emailed by the reply sorter itself. */
const EMAIL_TYPES = new Set(['profile.ready', 'cv.unreadable', 'membership.approved', 'membership.ending', 'membership.switch_offer', 'checkin', 'pack.ready', 'job.scam_alert', 'support.reply']);

export interface Viewer {
  userId: string;
  siteId: string;
  partner: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Db,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** On i-jobs a member sees all their notices; a partner site sees its own (row-level security). */
  private scoped<T>(v: Viewer, fn: (k: Kysely<DB>) => Promise<T>) {
    return v.partner ? this.db.forSite(v.siteId, (t) => fn(t)) : this.db.asEngine((t) => fn(t));
  }

  async list(v: Viewer, f: { unread?: boolean; cursor?: string; limit: number }) {
    const after = decodeCursor(f.cursor);
    return this.scoped(v, async (k) => {
      let q = k.selectFrom('notifications').selectAll().where('user_id', '=', v.userId);
      if (f.unread) q = q.where('read_at', 'is', null);
      if (after) q = q.where((eb: ExpressionBuilder<any, any>) => eb.or([eb('created_at', '<', after.at), eb.and([eb('created_at', '=', after.at), eb('id', '<', after.id)])]));
      const [rows, unread] = await Promise.all([
        q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(f.limit + 1).execute(),
        k.selectFrom('notifications').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', v.userId).where('read_at', 'is', null).executeTakeFirstOrThrow(),
      ]);
      const p = page(rows, f.limit, (r) => ({ at: new Date(r.created_at as unknown as string).toISOString(), id: r.id }));
      return {
        unread_count: unread.n,
        items: p.items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, read: !!n.read_at, created_at: new Date(n.created_at as unknown as string).toISOString() })),
        next_cursor: p.next_cursor,
      };
    });
  }

  async markRead(v: Viewer, ids?: string[]) {
    await this.scoped(v, (k) =>
      k.updateTable('notifications').set({ read_at: sql`now()` }).where('user_id', '=', v.userId).where('read_at', 'is', null).$if(!!ids?.length, (q) => q.where('id', 'in', ids!)).execute(),
    );
  }

  /** Worker: email the important ones, once. */
  async deliverEmails(limit = 200): Promise<{ sent: number }> {
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('notifications as n').innerJoin('users as u', 'u.id', 'n.user_id')
        .select(['n.id', 'n.type', 'n.title', 'n.body', 'u.email', 'u.status'])
        .where('n.sent_at', 'is', null).where('n.created_at', '>', sql<Date>`now() - interval '2 days'`)
        .orderBy('n.created_at').limit(limit).execute(),
    );
    let sent = 0;
    for (const n of rows) {
      if (EMAIL_TYPES.has(n.type) && n.email && n.status === 'active') {
        await this.mail.send({ to: n.email, subject: n.title, text: `${n.body ?? ''}\n\nOpen i-jobs: ${this.config.PUBLIC_APP_URL}`.trim() });
        sent++;
      }
      await this.db.asEngine((trx) => trx.updateTable('notifications').set({ sent_at: sql`now()`, channel: EMAIL_TYPES.has(n.type) && n.email ? 'email' : 'in_app' }).where('id', '=', n.id).execute());
    }
    return { sent };
  }
}

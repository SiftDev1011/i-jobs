import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';

/** Our team approving and banning communities. */
@Injectable()
export class AdminCommunitiesService {
  constructor(
    private readonly db: Db,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Approval also verifies the owner's identity and bank account, which the review checked. */
  async verify(communityId: string, staffId: string, decision: 'approved' | 'rejected' | 'needs_more_info', note?: string) {
    const c = await this.db.asEngine(async (trx) => {
      const c = await trx.selectFrom('communities as c').innerJoin('users as u', 'u.id', 'c.owner_user_id').select(['c.id', 'c.name', 'c.status', 'c.owner_user_id', 'u.email']).where('c.id', '=', communityId).executeTakeFirst();
      if (!c) throw Problem.notFound('community_not_found', 'There is no community here');
      if (c.status === 'banned') throw Problem.conflict('community_banned', 'This community is banned');
      await trx.updateTable('community_verifications').set({ decision, reviewer_id: staffId, reviewer_note: note ?? null, decided_at: sql`now()` })
        .where('id', '=', (eb) => eb.selectFrom('community_verifications').select('id').where('community_id', '=', communityId).orderBy('submitted_at', 'desc').limit(1)).execute();
      if (decision === 'approved') {
        await trx.updateTable('communities').set({ status: 'active', verified_at: sql`now()`, verified_by: staffId }).where('id', '=', communityId).execute();
        await trx.updateTable('owner_profiles').set({ identity_verified_at: sql`coalesce(identity_verified_at, now())`, payout_eligible: sql`bank_account_hash IS NOT NULL` }).where('user_id', '=', c.owner_user_id).execute();
      }
      if (decision !== 'needs_more_info') {
        await trx.updateTable('moderation_items').set({ status: decision }).where('subject_type', '=', 'community').where('subject_id', '=', communityId).where('status', 'in', ['open', 'in_review']).execute();
      }
      await trx.insertInto('audit_log').values({ actor_user_id: staffId, actor_kind: 'staff', action: `community.${decision}`, subject_type: 'community', subject_id: communityId, meta: JSON.stringify({ note: note ?? null }) }).execute();
      return c;
    });
    if (c.email) {
      const text = decision === 'approved'
        ? `${c.name} is approved. Share your join link and invite your members: ${this.config.PUBLIC_APP_URL}/owner`
        : decision === 'needs_more_info' ? `We need a little more to approve ${c.name}: ${note ?? 'please check your application.'}` : `We could not approve ${c.name}.${note ? ` ${note}` : ''}`;
      await this.mail.send({ to: c.email, subject: `Your community on i-jobs: ${c.name}`, text });
    }
    return { id: communityId, decision };
  }

  /**
   * Ban: unused codes are voided and payouts frozen (database trigger). Members keep access until
   * the end of what they paid for, then get an offer to switch communities.
   */
  async ban(communityId: string, staffId: string, reason: string) {
    return this.db.asEngine(async (trx) => {
      const c = await trx.updateTable('communities').set({ status: 'banned', banned_at: sql`now()`, ban_reason: reason }).where('id', '=', communityId).where('status', '!=', 'banned').returning(['id', 'owner_user_id']).executeTakeFirst();
      if (!c) throw Problem.notFound('community_not_found', 'There is no community to ban here');
      await trx.updateTable('owner_profiles').set({ banned_at: sql`now()`, payout_eligible: false }).where('user_id', '=', c.owner_user_id).execute();
      // Members waiting to join or pay won't be charged.
      await trx.updateTable('memberships').set({ status: 'cancelled', cancelled_at: sql`now()` }).where('community_id', '=', communityId).where('status', 'in', ['pending_approval', 'pending_payment']).execute();
      await trx.insertInto('audit_log').values({ actor_user_id: staffId, actor_kind: 'staff', action: 'community.ban', subject_type: 'community', subject_id: communityId, meta: JSON.stringify({ reason }) }).execute();
      const counts = await trx.selectFrom('memberships').select(sql<number>`count(*)::int`.as('n')).where('community_id', '=', communityId).where('status', 'in', ['active', 'trialing']).executeTakeFirstOrThrow();
      return { id: communityId, status: 'banned', members_keeping_access: counts.n };
    });
  }
}

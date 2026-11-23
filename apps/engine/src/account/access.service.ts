import { Injectable } from '@nestjs/common';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { AccountService } from './account.service';

/**
 * Who may use job features. i-jobs itself needs an active (or trialing) community membership;
 * partner sites decide access themselves. Age rules apply everywhere.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly db: Db,
    private readonly account: AccountService,
  ) {}

  async assertJobFeatures(userId: string, siteId: string) {
    const [me, site] = await Promise.all([
      this.account.getMe(userId, siteId),
      this.db.k.selectFrom('sites').select('requires_community').where('id', '=', siteId).executeTakeFirst(),
    ]);
    if (me.features_locked) throw Problem.forbidden('age_restricted', 'Job features are not available for this account yet');
    if (site?.requires_community && !me.active_membership) {
      throw Problem.forbidden('membership_inactive', 'Join a community, or renew your membership, to use job matching');
    }
    return me;
  }

  async hasConsent(userId: string, purpose: 'matching' | 'autopilot' | 'training_data') {
    const row = await this.db.k.selectFrom('current_consents').select(['granted']).where('user_id', '=', userId).where('purpose', '=', purpose).executeTakeFirst();
    return row?.granted === true;
  }

  async assertConsent(userId: string, purpose: 'matching' | 'autopilot') {
    if (!(await this.hasConsent(userId, purpose))) {
      const what = purpose === 'matching' ? 'reading your CV and matching you to jobs' : 'sending applications in your name';
      throw Problem.forbidden('consent_required', `Agree to ${what} first`);
    }
  }
}

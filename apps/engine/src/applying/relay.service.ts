import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';

/**
 * Each member's relay address, e.g. ada.k3x9p2@apply.ijobs.example. Employers reply to it;
 * the Cloudflare email worker passes replies to us, and we pass them on to the member.
 */
@Injectable()
export class RelayService {
  constructor(private readonly db: Db) {}

  async ensure(userId: string): Promise<{ id: string; address: string; domain: string }> {
    const existing = await this.db.asEngine((trx) => trx.selectFrom('relay_addresses').select(['id', 'local_part', 'domain']).where('user_id', '=', userId).executeTakeFirst());
    if (existing) return { id: existing.id, address: `${existing.local_part}@${existing.domain}`, domain: existing.domain };

    const [user, domain] = await Promise.all([
      this.db.asEngine((trx) => trx.selectFrom('users').select('full_name').where('id', '=', userId).executeTakeFirstOrThrow()),
      this.db.asEngine((trx) => trx.selectFrom('sending_domains').select('domain').where('purpose', '=', 'relay').where('paused', '=', false).orderBy('daily_limit', 'desc').executeTakeFirst()),
    ]);
    if (!domain) throw new Error('No relay sending domain is set up');
    const first = (user.full_name ?? '').split(/\s+/)[0].toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '').slice(0, 20) || 'member';
    for (let i = 0; i < 5; i++) {
      const local = `${first}.${randomBytes(4).toString('hex').slice(0, 6)}`;
      const row = await this.db.asEngine((trx) =>
        trx.insertInto('relay_addresses').values({ user_id: userId, local_part: local, domain: domain.domain }).onConflict((oc) => oc.doNothing()).returning(['id', 'local_part', 'domain']).executeTakeFirst(),
      );
      if (row) return { id: row.id, address: `${row.local_part}@${row.domain}`, domain: row.domain };
      const raced = await this.db.asEngine((trx) => trx.selectFrom('relay_addresses').select(['id', 'local_part', 'domain']).where('user_id', '=', userId).executeTakeFirst());
      if (raced) return { id: raced.id, address: `${raced.local_part}@${raced.domain}`, domain: raced.domain };
    }
    throw new Error('Could not create a relay address');
  }
}

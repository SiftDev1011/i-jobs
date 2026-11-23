import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Db } from '../db/db.service';

/** Housekeeping that runs every hour: removes expired codes, sessions and stored retries. */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('Maintenance');

  constructor(private readonly db: Db) {}

  async hourly(): Promise<Record<string, number>> {
    return this.db.asEngine(async (trx) => {
      const count = (r: { numDeletedRows?: bigint; numUpdatedRows?: bigint }[]) =>
        Number(r[0]?.numDeletedRows ?? r[0]?.numUpdatedRows ?? 0);

      const result = {
        idempotency_keys: count(await trx.deleteFrom('idempotency_keys').where('expires_at', '<', sql<Date>`now()`).execute()),
        auth_codes: count(await trx.deleteFrom('auth_codes').where('created_at', '<', sql<Date>`now() - interval '1 day'`).execute()),
        sessions: count(
          await trx
            .deleteFrom('sessions')
            .where((eb) =>
              eb.or([
                eb('expires_at', '<', sql<Date>`now() - interval '7 days'`),
                eb('revoked_at', '<', sql<Date>`now() - interval '7 days'`),
              ]),
            )
            .execute(),
        ),
        apply_meter: count(await trx.deleteFrom('apply_meter').where('delete_after', '<', sql<Date>`now()`).execute()),
        guardian_links_expired: count(
          await trx
            .updateTable('guardian_consents')
            .set({ status: 'expired' })
            .where('status', '=', 'pending')
            .where('created_at', '<', sql<Date>`now() - interval '14 days'`)
            .execute(),
        ),
      };
      this.logger.log(`Hourly cleanup: ${JSON.stringify(result)}`);
      return result;
    });
  }
}

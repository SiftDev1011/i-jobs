import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql, Transaction } from 'kysely';
import { Pool, types } from 'pg';
import { AppConfig, CONFIG } from '../config/config';
import type { DB } from './schema';

// Return `date` columns as 'YYYY-MM-DD' strings instead of shifting them through local time.
types.setTypeParser(1082, (v) => v);

export type Trx = Transaction<DB>;

/**
 * Database access. Use `forSite` inside request handlers so row-level security
 * limits partner sites to their own rows; use `asEngine` in background workers.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;
  readonly k: Kysely<DB>;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX });
    this.k = new Kysely<DB>({ dialect: new PostgresDialect({ pool: this.pool }) });
  }

  /** Runs `fn` in a transaction that can only see `siteId`'s rows in site-scoped tables. */
  forSite<T>(siteId: string, fn: (trx: Trx) => Promise<T>): Promise<T> {
    return this.k.transaction().execute(async (trx) => {
      await sql`select set_config('app.site_id', ${siteId}, true)`.execute(trx);
      return fn(trx);
    });
  }

  /** Runs `fn` in a transaction that sees every site's rows. Workers and system jobs only. */
  asEngine<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
    return this.k.transaction().execute(async (trx) => {
      await sql`select set_config('app.role', 'engine', true)`.execute(trx);
      return fn(trx);
    });
  }

  async ping(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.k);
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.k.destroy();
  }
}

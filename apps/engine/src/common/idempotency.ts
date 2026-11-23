import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { Actor, actorScope } from '../auth/actor';
import { Db } from '../db/db.service';
import { sha256Hex } from './crypto';
import { Problem } from './problem';

const IDEMPOTENT = 'ijobs:idempotent';

/** Marks an endpoint that charges money or sends something. It then requires an Idempotency-Key header. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/**
 * The first request with a key runs normally and its answer is stored for 24 hours.
 * Retries with the same key and body get the same answer back without running again.
 * The same key with a different body is refused.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request & { actor: Actor }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key')?.trim();
    if (!key) throw Problem.badRequest('idempotency_key_required', 'Add an Idempotency-Key header to this request');
    if (key.length > 100) throw Problem.badRequest('idempotency_key_invalid', 'Idempotency-Key must be 100 characters or fewer');

    const scope = actorScope(req.actor);
    const path = req.originalUrl.split('?')[0];
    const requestHash = sha256Hex(`${req.method} ${path}\n${JSON.stringify(req.body ?? null)}`);

    return from(this.claim(scope, key, req.method, path, requestHash)).pipe(
      mergeMap((existing) => {
        if (existing) {
          res.status(existing.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(existing.body);
        }
        return next.handle().pipe(
          tap(async (body) => {
            await this.db.k
              .updateTable('idempotency_keys')
              .set({ status_code: res.statusCode, response_body: JSON.stringify(body ?? null) })
              .where('scope', '=', scope)
              .where('key', '=', key)
              .execute();
          }),
          catchError(async (err) => {
            // Let the caller retry with the same key after a failure.
            await this.db.k.deleteFrom('idempotency_keys').where('scope', '=', scope).where('key', '=', key).execute();
            throw err;
          }),
        );
      }),
    );
  }

  /** Returns a stored answer to replay, or null if this request should run. */
  private async claim(scope: string, key: string, method: string, path: string, requestHash: string) {
    await this.db.k.deleteFrom('idempotency_keys').where('expires_at', '<', sql<Date>`now()`).where('scope', '=', scope).execute();
    const inserted = await this.db.k
      .insertInto('idempotency_keys')
      .values({ scope, key, method, path, request_hash: requestHash })
      .onConflict((oc) => oc.columns(['scope', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();
    if (inserted) return null;

    const row = await this.db.k
      .selectFrom('idempotency_keys')
      .select(['request_hash', 'status_code', 'response_body'])
      .where('scope', '=', scope)
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    if (row.request_hash !== requestHash) {
      throw Problem.unprocessable('idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
    }
    if (row.status_code === null) {
      throw Problem.conflict('request_in_progress', 'The first request with this key is still running');
    }
    return { status: row.status_code, body: row.response_body };
  }
}

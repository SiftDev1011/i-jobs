import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { SitesService } from '../sites/sites.service';
import { Actor, AUTH_MODE, AuthMode } from './actor';
import { TokensService } from './tokens.service';

export const revokedSessionKey = (sessionId: string) => `revoked-session:${sessionId}`;

/** Works out who is calling and whether this endpoint lets them in. Runs on every request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly sites: SitesService,
    private readonly db: Db,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<AuthMode>(AUTH_MODE, [ctx.getHandler(), ctx.getClass()]) ?? 'required';
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const actor = await this.identify(req);
    req.actor = actor;

    switch (mode) {
      case 'public':
        return true;
      case 'required':
        if (actor.kind === 'anonymous') throw Problem.unauthorized();
        return true;
      case 'user':
        if (actor.kind !== 'user') throw Problem.unauthorized('user_token_required', 'Sign in to continue');
        return true;
      case 'site':
        if (actor.kind !== 'site') throw Problem.unauthorized('site_key_required', 'This endpoint needs a partner site key');
        return true;
      case 'staff': {
        if (actor.kind !== 'user') throw Problem.unauthorized();
        const staff = await this.db.k
          .selectFrom('staff_members')
          .select('role')
          .where('user_id', '=', actor.userId)
          .executeTakeFirst();
        if (!staff) throw Problem.forbidden('staff_only', 'Only i-jobs staff can do this');
        actor.staffRole = staff.role;
        return true;
      }
    }
  }

  private async identify(req: Request): Promise<Actor> {
    const authz = req.headers.authorization;
    if (authz?.startsWith('Bearer ')) {
      const claims = await this.tokens.verifyAccess(authz.slice(7).trim());
      if (await this.redis.client.exists(revokedSessionKey(claims.sessionId))) {
        throw Problem.unauthorized('session_ended', 'You signed out. Sign in again.');
      }
      return { kind: 'user', siteId: claims.siteId, userId: claims.userId, sessionId: claims.sessionId };
    }

    const key = req.header('x-site-key');
    if (key) {
      const site = await this.sites.byKey(key);
      if (!site) throw Problem.unauthorized('site_key_invalid', 'This site key is not recognised');
      const externalUserId = req.header('x-site-user')?.trim() || null;
      let userId: string | null = null;
      if (externalUserId) {
        const row = await this.db.forSite(site.id, (trx) =>
          trx
            .selectFrom('site_accounts')
            .select('user_id')
            .where('site_id', '=', site.id)
            .where('external_user_id', '=', externalUserId)
            .executeTakeFirst(),
        );
        userId = row?.user_id ?? null;
      }
      return { kind: 'site', siteId: site.id, userId, externalUserId };
    }

    return { kind: 'anonymous', siteId: null, userId: null };
  }
}

import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Problem } from '../common/problem';

/** Who is calling. Attached to every request by the AuthGuard. */
export type Actor =
  | { kind: 'user'; siteId: string; userId: string; sessionId: string; staffRole?: string | null }
  | { kind: 'site'; siteId: string; userId: string | null; externalUserId: string | null }
  | { kind: 'anonymous'; siteId: null; userId: null };

/**
 * - required (default): a signed-in user or a partner site
 * - public: anyone; credentials are read if present
 * - user: a signed-in user only
 * - site: a partner site key only
 * - staff: a signed-in staff member
 */
export type AuthMode = 'required' | 'public' | 'user' | 'site' | 'staff';
export const AUTH_MODE = 'ijobs:auth-mode';

export const Auth = (mode: AuthMode) => SetMetadata(AUTH_MODE, mode);
export const Public = () => Auth('public');

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().actor;
});

/** The person the request is about. Partner sites must name their user with X-Site-User. */
export function userIdOf(actor: Actor): string {
  if (actor.kind === 'user') return actor.userId;
  if (actor.kind === 'site') {
    if (!actor.externalUserId) throw Problem.badRequest('site_user_required', 'Add X-Site-User to act for one of your users');
    if (!actor.userId) {
      throw Problem.notFound('site_user_not_linked', 'This user has not been linked yet. Call POST /partner/users first.');
    }
    return actor.userId;
  }
  throw Problem.unauthorized();
}

/** A stable key for things like Idempotency-Key scoping. */
export function actorScope(actor: Actor): string {
  if (actor.kind === 'user') return `user:${actor.userId}`;
  if (actor.kind === 'site') return `site:${actor.siteId}:${actor.externalUserId ?? '-'}`;
  return 'anonymous';
}

/** Staff-only actions: the guard has already checked the person is staff; this checks the role. */
export function requireRole(actor: Actor, roles: string[]) {
  const role = actor.kind === 'user' ? actor.staffRole : null;
  if (!role || !roles.includes(role)) throw Problem.forbidden('role_required', `Only ${roles.join(' or ')} staff can do this`);
}

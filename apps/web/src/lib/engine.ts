import 'server-only';
import createClient from 'openapi-fetch';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { components, paths } from './api-types';
import { env } from './env';
import { ACCESS_COOKIE } from './session';

export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'];

/** An error answer from the engine, with its stable `code` (problem+json). */
export class EngineError extends Error {
  constructor(public readonly status: number, public readonly problem: Partial<Problem>) {
    super(problem.title ?? `Engine answered ${status}`);
  }
  get code() {
    return this.problem.code ?? 'unknown';
  }
}

/** The person's address, passed on so the engine's rate limits apply per person, not to this server. */
export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;
}

/**
 * A typed engine client for this request, signed in when the person is.
 * Middleware has already refreshed the access token if it was about to expire.
 */
export async function engine(opts: { anonymous?: boolean } = {}) {
  const jar = await cookies();
  const token = opts.anonymous ? undefined : jar.get(ACCESS_COOKIE)?.value;
  const ip = await clientIp();
  return createClient<paths>({
    baseUrl: `${env.ENGINE_URL}/v1`,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    fetch: (req) => fetch(req, { cache: 'no-store' }),
  });
}

/** Answers that mean "not signed in (any more)": send the person to sign in. */
const SESSION_GONE = new Set(['user_token_required', 'session_ended', 'token_invalid', 'token_expired']);

/** Unwraps an openapi-fetch result: the data, or an EngineError. A lost session redirects to sign-in. */
export function must<T>(r: { data?: T; error?: unknown; response: Response }): T {
  if (r.error !== undefined || !r.response.ok) {
    const p = (r.error && typeof r.error === 'object' ? r.error : {}) as Partial<Problem>;
    if (r.response.status === 401 && p.code && SESSION_GONE.has(p.code)) redirect('/sign-in');
    throw new EngineError(r.response.status, p);
  }
  return r.data as T;
}

/** Like `must`, but a 404 becomes null. */
export function maybe<T>(r: { data?: T; error?: unknown; response: Response }): T | null {
  if (r.response.status === 404) return null;
  return must(r);
}

/** The signed-in person, or null. */
export async function currentUser(): Promise<Schemas['Me'] | null> {
  const jar = await cookies();
  if (!jar.get(ACCESS_COOKIE)) return null;
  const api = await engine();
  const r = await api.GET('/me');
  if (r.response.status === 401) return null;
  return must(r);
}

export type Features = { phone_sign_in: boolean; phone_invites: boolean; free_weeks: boolean };
const NO_TEXTS: Features = { phone_sign_in: false, phone_invites: false, free_weeks: false };

let featuresCache: { at: number; value: Features } | null = null;

/**
 * What the engine offers. Texts are optional (SMS_DRIVER=none on the engine): without them there's
 * no phone sign-in, no phone invites and no free weeks, so pages hide those. Kept in memory for a
 * minute (never on disk, so a restart always asks again); if the engine can't be asked, phone
 * features stay hidden.
 */
export async function features(): Promise<Features> {
  if (featuresCache && Date.now() - featuresCache.at < 60_000) return featuresCache.value;
  try {
    const r = await fetch(`${env.ENGINE_URL}/v1/features`, { cache: 'no-store' });
    if (!r.ok) return NO_TEXTS;
    const value = { ...NO_TEXTS, ...((await r.json()) as Partial<Features>) };
    featuresCache = { at: Date.now(), value };
    return value;
  } catch {
    return NO_TEXTS;
  }
}

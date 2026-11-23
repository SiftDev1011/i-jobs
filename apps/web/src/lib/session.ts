/** Session cookies. Both are httpOnly: page scripts can't read them. */
export const ACCESS_COOKIE = 'ij_at';
export const REFRESH_COOKIE = 'ij_rt';
export const REFRESH_DAYS = 30;

/** Seconds until a JWT expires (0 when unreadable). Not a security check: the engine verifies tokens. */
export function secondsLeft(token: string | undefined, now = Date.now()): number {
  if (!token) return 0;
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? Math.max(0, json.exp - Math.floor(now / 1000)) : 0;
  } catch {
    return 0;
  }
}

export interface Tokens { access_token: string; refresh_token: string; expires_in: number }

export function cookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge };
}

/** Where to send someone after signing in: only paths on this site. */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

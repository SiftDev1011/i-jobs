import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_DAYS, cookieOptions, secondsLeft, type Tokens } from './lib/session';

/**
 * Keeps the person signed in: when the access token is missing or has under a minute left and
 * a refresh token exists, swap it for new tokens before the page renders. The engine returns the
 * same new tokens to parallel requests for a few seconds, so tabs loading at once don't sign out.
 */
export async function middleware(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  // App pages need a session: send people to sign in, then back to the page they asked for.
  if (!access && !refresh && isAppPage(req)) return toSignIn(req);
  if (!refresh || secondsLeft(access) > 60) return NextResponse.next();

  const engine = (process.env.ENGINE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const secure = process.env.NODE_ENV === 'production';
  let r: Response;
  try {
    r = await fetch(`${engine}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ipOf(req) ? { 'x-forwarded-for': ipOf(req)! } : {}) },
      body: JSON.stringify({ refresh_token: refresh }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.next(); // Engine unreachable: carry on; pages show their own error.
  }

  if (r.status === 401) {
    req.cookies.delete(ACCESS_COOKIE);
    req.cookies.delete(REFRESH_COOKIE);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }
  if (!r.ok) return NextResponse.next();

  const t = (await r.json()) as Tokens;
  // Pages rendering this request see the new token; the browser stores it for the next one.
  req.cookies.set(ACCESS_COOKIE, t.access_token);
  req.cookies.set(REFRESH_COOKIE, t.refresh_token);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(ACCESS_COOKIE, t.access_token, cookieOptions(secure, t.expires_in));
  res.cookies.set(REFRESH_COOKIE, t.refresh_token, cookieOptions(secure, REFRESH_DAYS * 86400));
  return res;
}

function isAppPage(req: NextRequest) {
  const { pathname } = req.nextUrl;
  return (pathname === '/app' || pathname.startsWith('/app/')) && req.method === 'GET' && !req.headers.get('next-action');
}

function toSignIn(req: NextRequest) {
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

function ipOf(req: NextRequest) {
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export const config = {
  // Pages and server actions only; not static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp|txt|xml)$).*)'],
};

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import createClient from 'openapi-fetch';
import type { paths } from '@/lib/api-types';
import { engine, EngineError, must, features } from '@/lib/engine';
import { POLICY_VERSION } from '@/lib/labels';
import { env } from '@/lib/env';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_DAYS, cookieOptions, safeNext } from '@/lib/session';

export type FormState = { ok?: boolean; error?: string; field?: string; target?: string } | null;

/** Lagos-style numbers become +234…; emails stay as they are. */
const EMAIL = /^(?!\.)(?!.*\.\.)[^\s@]+(?<!\.)@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function normaliseTarget(raw: string): { target: string; channel: 'email' | 'sms' } | null {
  const v = raw.trim();
  // Same rule as the engine: no trailing or doubled dots (phone keyboards and autofill add them), a real top-level domain.
  if (v.includes('@')) return EMAIL.test(v) ? { target: v.toLowerCase(), channel: 'email' } : null;
  const digits = v.replace(/[\s()-]/g, '');
  if (/^0[789][01]\d{8}$/.test(digits)) return { target: `+234${digits.slice(1)}`, channel: 'sms' };
  if (/^\+\d{8,15}$/.test(digits)) return { target: digits, channel: 'sms' };
  return null;
}

function friendly(e: unknown): string {
  if (e instanceof EngineError) {
    if (e.status === 429) return 'Too many tries. Wait a few minutes and try again.';
    if (e.code === 'code_invalid') return 'That code is not right. Check it and try again.';
    if (e.code === 'code_expired') return 'That code has expired. Ask for a new one.';
    if (e.code === 'code_locked') return 'Too many wrong tries. Ask for a new code.';
    if (e.code === 'account_suspended') return 'This account is suspended. Contact support.';
    return e.problem.errors?.[0]?.message ?? e.message;
  }
  return 'We couldn’t reach i-jobs. Check your connection and try again.';
}

export async function sendCode(_prev: FormState, form: FormData): Promise<FormState> {
  const t = normaliseTarget(String(form.get('target') ?? ''));
  if (!t) return { error: (await features()).phone_sign_in ? 'Enter your email address or a phone number like 0803 123 4567.' : 'Enter your email address.', field: 'target' };
  try {
    const api = await engine({ anonymous: true });
    must(await api.POST('/auth/codes', { body: { target: t.target, channel: t.channel } }));
    return { ok: true, target: t.target };
  } catch (e) {
    return { error: friendly(e), field: 'target' };
  }
}

export async function verifyCode(_prev: FormState, form: FormData): Promise<FormState> {
  const target = String(form.get('target') ?? '');
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  const next = safeNext(String(form.get('next') ?? ''));
  if (code.length !== 6) return { error: 'Enter the 6-digit code.', field: 'code', target };
  try {
    const api = await engine({ anonymous: true });
    const s = must(await api.POST('/auth/sessions', { body: { target, code } }));
    const jar = await cookies();
    jar.set(ACCESS_COOKIE, s.access_token, cookieOptions(env.secureCookies, s.expires_in));
    jar.set(REFRESH_COOKIE, s.refresh_token, cookieOptions(env.secureCookies, REFRESH_DAYS * 86400));
    // "By continuing you agree to the terms and privacy notice": keep a record of it.
    const authed = createClient<paths>({ baseUrl: `${env.ENGINE_URL}/v1`, headers: { authorization: `Bearer ${s.access_token}` } });
    await Promise.all((['terms', 'privacy'] as const).map((purpose) =>
      authed.POST('/me/consents', { body: { purpose, granted: true, policy_version: POLICY_VERSION } }).catch(() => undefined)));
  } catch (e) {
    return { error: friendly(e), field: 'code', target };
  }
  redirect(next);
}

export async function signOut() {
  try {
    const api = await engine();
    await api.DELETE('/auth/sessions/current');
  } catch {
    /* signing out locally is what matters */
  }
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect('/');
}

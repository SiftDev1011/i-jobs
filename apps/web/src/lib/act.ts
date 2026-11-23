import 'server-only';
import { revalidatePath } from 'next/cache';
import { EngineError } from './engine';

export type Result<T = undefined> = { ok: true; data?: T; note?: string } | { ok: false; error: string; field?: string };

/** Runs an engine call and turns its errors into words for the form. Redirects pass through. */
export async function act<T>(fn: () => Promise<T>, revalidate?: string | string[]): Promise<Result<T>> {
  try {
    const data = await fn();
    for (const p of [revalidate ?? []].flat()) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof EngineError) {
      if (e.status === 429) return { ok: false, error: e.problem.detail ?? 'Too many tries. Wait a few minutes and try again.' };
      const first = e.problem.errors?.[0];
      return { ok: false, error: first?.message ?? e.problem.detail ?? e.message, field: first?.field };
    }
    if (e instanceof TypeError) return { ok: false, error: 'We couldn’t reach i-jobs. Check your connection and try again.' };
    throw e;
  }
}

export const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
export const list = (v: string) => [...new Set(v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
export const checked = (f: FormData, k: string) => f.get(k) === 'on' || f.get(k) === 'true';

/** Naira typed by a person ("5,000" or "5000.50") to kobo, or null. */
export function toKobo(v: string): number | null {
  const n = Number(v.replace(/[₦,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Lagos-style numbers become +234…. */
export function e164(raw: string): string | null {
  const d = raw.replace(/[\s()-]/g, '');
  if (/^0[789][01]\d{8}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^234[789][01]\d{8}$/.test(d)) return `+${d}`;
  if (/^\+[1-9]\d{6,14}$/.test(d)) return d;
  return null;
}

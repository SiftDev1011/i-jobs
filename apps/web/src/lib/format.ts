import type { components } from './api-types';

type Job = components['schemas']['JobSummary'];
type Pay = components['schemas']['Pay'];

const TILE = ['t-green', 't-yellow', 't-blue', 't-red', 't-purple', 't-ink'] as const;

/** Two letters for a company tile, and a stable colour for it. */
export function companyTile(name: string): { initials: string; colour: (typeof TILE)[number] } {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { initials, colour: TILE[h % TILE.length] };
}

const PERIOD: Record<string, string> = { hour: 'an hour', day: 'a day', week: 'a week', month: 'a month', year: 'a year', project: 'per project' };

export function money(minor: number, currency: string, compact = false): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
      ...(compact && major >= 100_000 ? { notation: 'compact' as const } : {}),
    }).format(major);
  } catch {
    return `${currency} ${Math.round(major).toLocaleString('en-NG')}`;
  }
}

/** "₦350K–₦450K" and "a month", or null when the job doesn't say. */
export function payLabel(pay: Pay | undefined): { amount: string; period: string } | null {
  if (!pay?.currency || (pay.min_minor == null && pay.max_minor == null)) return null;
  const c = pay.currency;
  const lo = pay.min_minor != null ? money(pay.min_minor, c, true) : null;
  const hi = pay.max_minor != null ? money(pay.max_minor, c, true) : null;
  const amount = lo && hi && lo !== hi ? `${lo}–${hi}` : (lo ?? hi)!;
  return { amount, period: pay.period ? PERIOD[pay.period] ?? '' : '' };
}

const COUNTRY: Record<string, string> = { NG: 'Nigeria', GH: 'Ghana', KE: 'Kenya', ZA: 'South Africa', EG: 'Egypt', RW: 'Rwanda', UG: 'Uganda', TZ: 'Tanzania' };

export function whereLabel(job: Pick<Job, 'location_scope' | 'allowed_countries' | 'allowed_regions'>): string {
  if (job.location_scope === 'worldwide') return 'Worldwide';
  const regions = job.allowed_regions ?? [];
  if (regions.includes('africa')) return 'Remote in Africa';
  if (regions.includes('emea')) return 'Remote EMEA';
  const countries = job.allowed_countries ?? [];
  if (countries.length === 1) return `Remote in ${COUNTRY[countries[0]] ?? countries[0]}`;
  if (countries.length > 1) return `Remote: ${countries.slice(0, 3).join(', ')}${countries.length > 3 ? '…' : ''}`;
  return 'Remote';
}

const TYPE: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract', freelance: 'Freelance', internship: 'Internship', graduate: 'Graduate', temporary: 'Temporary' };
export const typeLabel = (t: string | null | undefined) => (t ? TYPE[t] ?? t : null);

export type BadgeIcon = 'shield' | 'flame' | 'cal' | 'cap' | 'video';
/** The one badge worth showing on a card. */
export function jobBadge(job: Pick<Job, 'trust' | 'badges'>): { cls: string; label: string; icon: BadgeIcon } | null {
  const b = job.badges ?? [];
  if (b.includes('closes_soon')) return { cls: 'b-red', label: 'Closes soon', icon: 'cal' };
  if (job.trust === 'verified_employer') return { cls: 'b-green', label: 'Verified employer', icon: 'shield' };
  if (b.includes('new_today')) return { cls: 'b-yellow', label: 'New today', icon: 'flame' };
  if (b.includes('internship')) return { cls: 'b-purple', label: 'Internship', icon: 'cap' };
  if (b.includes('grad_friendly')) return { cls: 'b-purple', label: 'Grad friendly', icon: 'cap' };
  if (b.includes('side_gig')) return { cls: 'b-blue', label: 'Side gig', icon: 'video' };
  return null;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos',  day: 'numeric', month: 'short' });
}

/** "20 Nov 2026" in Lagos time; with `time`, "20 Nov, 14:05". */
export function dateLabel(iso: string | null | undefined, time = false): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos', day: 'numeric', month: 'short',
    ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : { year: 'numeric' }),
  });
}

/** A Money object as "₦5,000" (exact, for owner and staff pages). */
export const amount = (m: { amount_minor: number; currency: string } | null | undefined) => (m ? money(m.amount_minor, m.currency) : '—');

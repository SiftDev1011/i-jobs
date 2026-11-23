/** How complete a profile is (0-100) and the next few things that would improve matches. */

export interface ProfileShape {
  headline?: string | null;
  summary?: string | null;
  years_experience?: number | string | null;
  country?: string | null;
  timezone?: string | null;
  work_authorization?: { remote_any_country?: boolean; countries?: string[] } | null;
  skills?: string[];
  experience?: { title?: string; highlights?: string[] }[];
  education?: unknown[];
  languages?: string[];
  links?: string[];
  confirmed_at?: string | Date | null;
}

export function strength(p: ProfileShape): { score: number; tips: string[] } {
  const parts: [number, boolean, string][] = [
    [10, !!p.headline?.trim(), 'Add a headline, like "Customer support specialist"'],
    [10, (p.summary?.trim().length ?? 0) >= 80, 'Write a short summary of what you do best'],
    [20, (p.skills?.length ?? 0) >= 5, 'List at least 5 skills and tools you use'],
    [10, (p.skills?.length ?? 0) >= 10, 'Add more skills: tools, software and languages count'],
    [15, (p.experience?.length ?? 0) >= 1, 'Add your work experience, including internships and gigs'],
    [5, (p.experience ?? []).some((e) => (e.highlights?.length ?? 0) >= 2), 'Add two results to your latest role, like "Answered 60 tickets a day"'],
    [5, (p.education?.length ?? 0) >= 1, 'Add your education'],
    [10, (p.links?.length ?? 0) >= 1, 'Add a portfolio, GitHub or LinkedIn link'],
    [5, (p.languages?.length ?? 0) >= 1, 'Add the languages you speak'],
    [5, !!p.country && !!p.timezone, 'Set your country and time zone so we only show jobs you can take'],
    [5, !!p.work_authorization && (p.work_authorization.remote_any_country !== undefined || (p.work_authorization.countries?.length ?? 0) > 0), 'Tell us where you can legally work'],
  ];
  const score = parts.reduce((s, [w, ok]) => s + (ok ? w : 0), 0);
  const tips = parts.filter(([, ok]) => !ok).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, , tip]) => tip);
  return { score: Math.min(100, score), tips };
}

/** Whole hours from UTC for an IANA zone, today. null if the zone is unknown. */
export function utcOffsetHours(timezone: string | null | undefined, at = new Date()): number | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    return m ? Math.round(Number(m[1]) + (Number(m[2] ?? 0) / 60) * Math.sign(Number(m[1]) || 1)) : 0;
  } catch {
    return null;
  }
}

export function isTimezone(tz: string): boolean {
  return utcOffsetHours(tz) !== null;
}

/** Years worked, from experience dates, counting overlapping jobs once. */
export function yearsFromExperience(exp: { start?: string | null; end?: string | null; current?: boolean }[], now = new Date()): number | null {
  const ranges = exp
    .map((e) => [e.start ? Date.parse(e.start) : NaN, e.end ? Date.parse(e.end) : e.current || !e.end ? now.getTime() : NaN] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  if (!ranges.length) return null;
  let total = 0;
  let [curA, curB] = ranges[0];
  for (const [a, b] of ranges.slice(1)) {
    if (a <= curB) curB = Math.max(curB, b);
    else {
      total += curB - curA;
      [curA, curB] = [a, b];
    }
  }
  total += curB - curA;
  return Math.round((total / (365.25 * 86400_000)) * 10) / 10;
}

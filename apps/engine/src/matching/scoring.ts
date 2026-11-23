/**
 * How well one job fits one member, 0-100, with plain-language reasons and skill gaps.
 * No AI call: meaning (embeddings) when we have it, then skills, titles, seniority, place and hours.
 */
import { COUNTRIES } from '../ingest/places';

export interface MemberFacts {
  skills: string[]; // as the member wrote them
  headline: string | null;
  titles: string[]; // past job titles
  years: number | null;
  country: string | null;
  utcOffset: number | null;
}

export interface JobFacts {
  title: string;
  skills: string[];
  text: string; // title + description, any case
  seniority: string | null;
  employment_type: string | null;
  location_scope: 'worldwide' | 'unspecified' | 'restricted';
  allowed_countries: string[];
  is_remote: boolean;
  tz_min: number | null;
  tz_max: number | null;
}

export interface Fit {
  score: number;
  reasons: string[];
  gaps: string[];
}

const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'at', 'with', 'remote', 'senior', 'junior', 'sr', 'jr', 'lead', 'mid', 'level', 'i', 'ii', 'iii', 'iv', 'intern', 'm', 'f', 'd', 'w', 'x', 'h']);
const NEEDS_YEARS: Record<string, number> = { intern: 0, junior: 0, mid: 2, senior: 4, lead: 5, principal: 7, director: 7 };
const MAX_TZ_GAP = 4;

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9+#.]+/g, ' ').split(' ').map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 1 && !STOP.has(w));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** null means the member can't take this job (hours too far apart). */
export function fit(m: MemberFacts, j: JobFacts, similarity: number | null): Fit | null {
  // Hours: jobs that need overlap far from the member's time zone are left out.
  let tzGap = 0;
  if (m.utcOffset !== null && j.tz_min !== null && j.tz_max !== null) {
    tzGap = m.utcOffset < j.tz_min ? j.tz_min - m.utcOffset : m.utcOffset > j.tz_max ? m.utcOffset - j.tz_max : 0;
    if (tzGap > MAX_TZ_GAP) return null;
  }

  const jobSkills = new Set(j.skills.map((s) => s.toLowerCase()));
  const text = ` ${j.text.toLowerCase().slice(0, 6000)} `;
  const hits: string[] = [];
  for (const skill of m.skills) {
    const s = skill.toLowerCase().trim();
    if (s.length < 2) continue;
    if (jobSkills.has(s) || new RegExp(`(^|[^a-z0-9+#])${escape(s)}($|[^a-z0-9+#])`).test(text)) hits.push(skill);
  }
  // When the job lists skills, how many of them the member has; otherwise how many of theirs it mentions.
  const own = new Set(m.skills.map((s) => s.toLowerCase()));
  const covered = [...jobSkills].filter((s) => own.has(s)).length;
  const skillScore = jobSkills.size
    ? Math.max(covered / Math.min(jobSkills.size, 6), Math.min(1, hits.length / 4))
    : Math.min(1, hits.length / 3);

  const jobWords = new Set(words(j.title));
  const ownTitles = [m.headline ?? '', ...m.titles].filter(Boolean);
  let titleScore = 0;
  let bestTitle: string | null = null;
  for (const t of ownTitles) {
    const w = words(t);
    if (!w.length || !jobWords.size) continue;
    const overlap = w.filter((x) => jobWords.has(x)).length / jobWords.size;
    if (overlap > titleScore) {
      titleScore = overlap;
      bestTitle = t;
    }
  }
  titleScore = Math.min(1, titleScore);

  const needs = j.seniority ? NEEDS_YEARS[j.seniority] : undefined;
  const seniorityFit = needs === undefined || m.years === null ? 0.7 : m.years >= needs ? 1 : Math.max(0, 1 - (needs - m.years) / Math.max(needs, 1));

  const inCountry = !!m.country && j.allowed_countries.includes(m.country);
  const place = j.location_scope === 'restricted' ? (inCountry ? 1 : 0.8) : j.location_scope === 'worldwide' ? 0.8 : 0.5;

  const sem = similarity === null ? null : Math.min(1, Math.max(0, (similarity - 0.3) / 0.4));
  let score = sem === null
    ? 0.45 * skillScore + 0.3 * titleScore + 0.15 * seniorityFit + 0.1 * place
    : 0.4 * sem + 0.3 * skillScore + 0.15 * titleScore + 0.1 * seniorityFit + 0.05 * place;
  score *= 1 - 0.05 * tzGap;

  const reasons: string[] = [];
  if (bestTitle && titleScore >= 0.5) {
    reasons.push(m.years && m.years >= 1 ? `${formatYears(m.years)} of experience, including as ${bestTitle}` : `Your experience as ${bestTitle}`);
  } else if (m.years && m.years >= 1 && needs !== undefined && m.years >= needs) {
    reasons.push(`${formatYears(m.years)} of experience suits this level`);
  }
  if (hits.length) reasons.push(`Skills: ${hits.slice(0, 3).join(', ')}`);
  if (m.utcOffset !== null && j.tz_min !== null && tzGap === 0) reasons.push('Hours fit your time zone');
  if (j.location_scope === 'restricted' && inCountry) reasons.push(`Open to applicants in ${COUNTRIES.get(m.country!)?.name ?? m.country}`);
  else if (j.location_scope === 'worldwide') reasons.push('Open to applicants worldwide');
  else if (j.location_scope === 'unspecified') reasons.push('Location not stated: check before applying');
  if ((j.employment_type === 'internship' || j.employment_type === 'graduate' || j.seniority === 'junior') && (m.years ?? 0) < 2) reasons.push('Entry-level friendly');

  // Gaps: the job's listed skills the member doesn't have, the ones in the title first.
  const gaps = [...jobSkills].filter((s) => !own.has(s)).sort((a, b) => Number(j.title.toLowerCase().includes(b)) - Number(j.title.toLowerCase().includes(a))).slice(0, 3);

  return { score: Math.round(Math.min(1, Math.max(0, score)) * 100), reasons: reasons.slice(0, 4), gaps };
}

function formatYears(y: number) {
  const r = Math.round(y);
  return r === 1 ? '1 year' : `${r} years`;
}

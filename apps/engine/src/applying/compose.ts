import { z } from 'zod';
import { COUNTRIES } from '../ingest/places';
import { truncate } from '../ingest/text';

export interface Applicant {
  fullName: string;
  city: string | null;
  country: string | null;
  headline: string | null;
  summary: string | null;
  years: number | null;
  skills: string[];
  experience: { title?: string; company?: string; highlights?: string[] }[];
  links: string[];
}

export interface JobForLetter {
  title: string;
  company: string;
  description: string;
  skills: string[];
}

export interface Letter {
  subject: string;
  body: string;
  paragraph: string | null;
  claimsChecked: boolean;
}

/** The AI writes one short paragraph; everything else is a fixed template from the profile. */
export const AppParagraph = z.object({ paragraph: z.string().trim().min(20).max(900) });

export function paragraphPrompt(a: Applicant, j: JobForLetter) {
  const relevant = orderSkills(a.skills, j);
  return {
    system: [
      'You write one short paragraph (60-90 words) for a job application email, in the first person.',
      'Say why this person fits this job, using ONLY the facts given about them.',
      'Never mention a skill, tool, employer, number or achievement that is not in their facts. No greetings, no sign-off, no placeholders.',
      'Plain, warm, professional English. Return JSON: {"paragraph": "..."}',
    ].join('\n'),
    user: [
      `JOB: ${j.title} at ${j.company}`,
      truncate(j.description.replace(/\s+/g, ' '), 1800),
      '',
      'THEIR FACTS:',
      a.headline ? `Headline: ${a.headline}` : '',
      a.years !== null ? `Years of experience: ${Math.round(a.years)}` : '',
      `Skills: ${relevant.slice(0, 15).join(', ')}`,
      ...a.experience.slice(0, 3).map((e) => `Role: ${[e.title, e.company && `at ${e.company}`].filter(Boolean).join(' ')}${e.highlights?.length ? `. ${e.highlights.slice(0, 3).join('. ')}` : ''}`),
      a.summary ? `Summary: ${a.summary}` : '',
    ].filter(Boolean).join('\n'),
    maxOutputTokens: 700,
  };
}

/**
 * The claim check. A paragraph fails if it names one of the job's skills the person doesn't have,
 * claims more years than they have, or uses a number that appears nowhere in their facts.
 */
export function checkClaims(paragraph: string, a: Applicant, j: JobForLetter): { ok: boolean; problems: string[] } {
  const p = paragraph.toLowerCase();
  const facts = [a.headline, a.summary, ...a.skills, ...a.experience.flatMap((e) => [e.title, e.company, ...(e.highlights ?? [])])].filter(Boolean).join(' ').toLowerCase();
  const own = new Set(a.skills.map((s) => s.toLowerCase()));
  const problems: string[] = [];

  for (const skill of j.skills.map((s) => s.toLowerCase())) {
    if (own.has(skill) || facts.includes(skill)) continue;
    if (new RegExp(`(^|[^a-z0-9+#])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`).test(p)) problems.push(`mentions ${skill}`);
  }
  for (const m of p.matchAll(/(\d+)\+?\s*(years?|yrs?)/g)) {
    if (a.years === null || Number(m[1]) > Math.round(a.years)) problems.push(`claims ${m[1]} years`);
  }
  for (const m of p.matchAll(/\b\d[\d,.]*%?/g)) {
    const n = m[0].replace(/[,.]$/, '');
    if (/^(19|20)\d\d$/.test(n)) continue; // years in dates are fine if they're in the facts; checked below
    if (!facts.includes(n) && !(a.years !== null && n === String(Math.round(a.years)))) problems.push(`number ${n} not in profile`);
  }
  if (/\[|\{|lorem|your name|company name/i.test(paragraph)) problems.push('placeholder text');
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export function composeLetter(a: Applicant, j: JobForLetter, paragraph: string | null): Letter {
  const skills = orderSkills(a.skills, j).slice(0, 6);
  const latest = a.experience.find((e) => e.title);
  const place = [a.city, a.country ? (COUNTRIES.get(a.country)?.name ?? a.country) : null].filter(Boolean).join(', ');
  const links = a.links.slice(0, 2);
  const lines = [
    `Dear ${j.company} hiring team,`,
    '',
    `I'd like to apply for the ${j.title} role.`,
    '',
    ...(paragraph ? [paragraph, ''] : []),
    [a.headline, a.years !== null && a.years >= 1 ? `${Math.round(a.years)} year${Math.round(a.years) === 1 ? '' : 's'} of experience` : null].filter(Boolean).join(', ') + (a.headline || a.years ? '.' : ''),
    skills.length ? `Key skills: ${skills.join(', ')}.` : '',
    latest ? `Most recently: ${latest.title}${latest.company ? ` at ${latest.company}` : ''}.` : '',
    '',
    `My CV is attached.${links.length ? ` You can also see my work at ${links.join(' and ')}.` : ''} I'd be glad to share anything else you need.`,
    '',
    'Kind regards,',
    a.fullName,
    place,
    '',
    '—',
    `Sent with i-jobs on behalf of ${a.fullName}. Reply to this email to reach them directly.`,
  ];
  return {
    subject: `Application for ${j.title} – ${a.fullName}`,
    body: lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim(),
    paragraph,
    claimsChecked: paragraph !== null,
  };
}

/** The job's own skills first, then the rest. */
function orderSkills(skills: string[], j: JobForLetter): string[] {
  const wanted = new Set(j.skills.map((s) => s.toLowerCase()));
  const text = `${j.title} ${j.description}`.toLowerCase();
  return [...skills].sort((x, y) => rank(y) - rank(x));
  function rank(s: string) {
    const l = s.toLowerCase();
    return wanted.has(l) ? 2 : text.includes(l) ? 1 : 0;
  }
}

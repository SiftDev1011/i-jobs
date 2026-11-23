import { z } from 'zod';
import { truncate } from '../ingest/text';

/**
 * Prompts and answer shapes. Every answer is JSON checked against a zod schema;
 * anything else is thrown away rather than retried, to protect the free budget.
 */

const nullableStr = z.string().trim().min(1).nullable().catch(null);
const iso2 = z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase());

export const JobExtract = z.object({
  is_job: z.boolean(),
  title: z.string().trim().max(200).default(''),
  company: z.string().trim().max(120).default(''),
  company_website: nullableStr.default(null),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'graduate', 'temporary']).nullable().catch(null).default(null),
  remote: z.boolean().nullable().catch(null).default(null),
  location_text: nullableStr.default(null),
  countries: z.array(iso2).max(30).catch([]).default([]),
  regions: z.array(z.enum(['africa', 'emea', 'europe', 'latam', 'americas', 'north_america', 'apac', 'asia', 'middle_east', 'mena', 'oceania'])).catch([]).default([]),
  worldwide: z.boolean().catch(false).default(false),
  pay_min: z.number().positive().nullable().catch(null).default(null),
  pay_max: z.number().positive().nullable().catch(null).default(null),
  pay_currency: z.string().regex(/^[A-Za-z]{3}$/).nullable().catch(null).default(null),
  pay_period: z.enum(['hour', 'day', 'week', 'month', 'year', 'project']).nullable().catch(null).default(null),
  apply_email: z.string().email().nullable().catch(null).default(null),
  apply_url: z.string().url().nullable().catch(null).default(null),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null).default(null),
  summary: z.string().trim().max(400).default(''),
  skills: z.array(z.string().trim().min(1).max(40)).max(12).catch([]).default([]),
});
export type JobExtract = z.infer<typeof JobExtract>;

export function jobExtractPrompt(text: string, hints: { sourceName: string; postedAt?: Date | null }) {
  return {
    system: [
      'You read one job post and return JSON only, no prose.',
      'Use only facts in the post. Never guess a salary, deadline, email or link that is not written there.',
      'Fields:',
      '- is_job: false if this is not an offer of paid work, an internship or a training place (e.g. someone looking for work, an ad, a joke).',
      '- title, company: as written. company_website: only if a company site is given.',
      '- employment_type: full_time, part_time, contract, freelance, internship, graduate or temporary; null if not said.',
      '- remote: true if it can be done fully remotely, false if on-site or hybrid, null if not said.',
      '- location_text: the location words as written. countries: ISO 3166 alpha-2 codes of places named. regions: any of africa, emea, europe, latam, americas, north_america, apac, asia, middle_east, mena, oceania. worldwide: true only if it says anywhere/worldwide.',
      '- pay_min, pay_max: plain numbers (no symbols), pay_currency: ISO code, pay_period: hour/day/week/month/year/project.',
      '- apply_email, apply_url: how to apply, exactly as written. deadline: YYYY-MM-DD if a closing date is given.',
      '- summary: one or two plain sentences on what the job is (max 40 words). skills: up to 10 short skill names.',
    ].join('\n'),
    user: `Source: ${hints.sourceName}${hints.postedAt ? `, posted ${hints.postedAt.toISOString().slice(0, 10)}` : ''}\n\n${truncate(text, 7000)}`,
    maxOutputTokens: 900,
  };
}

export const ScamCheck = z.object({
  risk: z.number().min(0).max(1),
  verdict: z.enum(['ok', 'review', 'scam']),
  reasons: z.array(z.string().trim().max(60)).max(6).catch([]).default([]),
});
export type ScamCheck = z.infer<typeof ScamCheck>;

export function scamCheckPrompt(job: { title: string; company: string; description: string; applyEmail?: string | null; applyUrl?: string | null }, ruleReasons: string[]) {
  return {
    system: [
      'You screen job posts for scams aimed at job seekers in Nigeria and across Africa. Return JSON only.',
      'Common scams: fees for registration, training, equipment or visas; payment by gift cards or crypto; contact only by WhatsApp or Telegram;',
      'reshipping or receiving money for others; asking for BVN, bank logins or card details; pay far above normal for simple tasks; fake well-known brands.',
      'Many real small businesses use Gmail and WhatsApp; that alone is not a scam.',
      'Answer: {"risk": 0..1, "verdict": "ok"|"review"|"scam", "reasons": ["short_snake_case", ...]}.',
    ].join('\n'),
    user: [
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      job.applyEmail ? `Apply email: ${job.applyEmail}` : '',
      job.applyUrl ? `Apply link: ${job.applyUrl}` : '',
      ruleReasons.length ? `Rule flags: ${ruleReasons.join(', ')}` : '',
      '',
      truncate(job.description, 3500),
    ].filter((l) => l !== '').join('\n'),
    maxOutputTokens: 400,
  };
}

// ------------------------------------------------------------------ CV → profile

const monthDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
  .transform((s) => (s.length === 4 ? `${s}-01-01` : s.length === 7 ? `${s}-01` : s))
  .nullable()
  .catch(null);

export const CvParse = z.object({
  headline: z.string().trim().max(120).catch('').default(''),
  summary: z.string().trim().max(800).catch('').default(''),
  years_experience: z.number().min(0).max(60).nullable().catch(null).default(null),
  country: iso2.nullable().catch(null).default(null),
  city: z.string().trim().max(80).nullable().catch(null).default(null),
  skills: z.array(z.string().trim().min(1).max(50)).max(40).catch([]).default([]),
  experience: z
    .array(
      z.object({
        title: z.string().trim().max(120).catch(''),
        company: z.string().trim().max(120).catch(''),
        start: monthDate.default(null),
        end: monthDate.default(null),
        current: z.boolean().catch(false).default(false),
        highlights: z.array(z.string().trim().max(300)).max(5).catch([]).default([]),
      }),
    )
    .max(12)
    .catch([])
    .default([]),
  education: z
    .array(z.object({ school: z.string().trim().max(160).catch(''), qualification: z.string().trim().max(160).catch(''), year: z.number().int().min(1950).max(2100).nullable().catch(null).default(null) }))
    .max(8)
    .catch([])
    .default([]),
  languages: z.array(z.string().trim().min(1).max(40)).max(10).catch([]).default([]),
  links: z.array(z.string().url()).max(10).catch([]).default([]),
});
export type CvParse = z.infer<typeof CvParse>;

export function cvParsePrompt(text: string) {
  return {
    system: [
      'You turn one CV into JSON for a job-matching profile. Return JSON only.',
      'Use only what the CV says. Do not invent skills, dates or employers.',
      'Leave out the person\'s name, email, phone number and home address everywhere, including the summary.',
      'Fields: headline (their main role in a few words), summary (2-3 sentences, third person, max 60 words),',
      'years_experience (total paid work, a number), country (ISO 3166 alpha-2 of where they live, if stated), city,',
      'skills (up to 30 concrete skills and tools, short names, e.g. "Zendesk", "Customer service", "Excel"),',
      'experience (most recent first: title, company, start and end as YYYY-MM, current true if ongoing, up to 4 short highlights),',
      'education (school, qualification, year), languages, links (portfolio, GitHub, LinkedIn URLs as written).',
    ].join('\n'),
    user: truncate(text, 9000),
    maxOutputTokens: 1600,
  };
}

// ------------------------------------------------------------------ employer replies

export const ReplySort = z.object({
  class: z.enum(['interview', 'rejection', 'info_request', 'auto_reply', 'other']),
});

export function replySortPrompt(subject: string, text: string) {
  return {
    system: [
      'You sort an employer\'s email reply to a job application. Return JSON: {"class": "..."}.',
      'interview: invites them to an interview, call, test or next stage. rejection: they will not go ahead.',
      'info_request: asks for more information or documents. auto_reply: an automatic acknowledgement or out-of-office.',
      'other: anything else.',
    ].join('\n'),
    user: `Subject: ${subject}\n\n${truncate(text, 2500)}`,
    maxOutputTokens: 300,
  };
}

// ------------------------------------------------------------------ apply packs

export const ApplyPackAnswers = z.object({
  answers: z.array(z.object({ question: z.string().trim().min(5).max(200), draft: z.string().trim().min(20).max(1200) })).min(1).max(5),
});

export function applyPackPrompt(facts: string, job: { title: string; company: string; description: string }) {
  return {
    system: [
      'You help a job seeker prepare to apply on an employer\'s website. Return JSON only:',
      '{"answers": [{"question": "...", "draft": "..."}]} with 3 to 4 questions this employer is likely to ask',
      '(for example why this role, relevant experience, a result they are proud of) and a first-person draft answer for each (40-120 words).',
      'Use ONLY the facts given about the person. Never invent employers, numbers, skills or achievements.',
    ].join('\n'),
    user: `JOB: ${job.title} at ${job.company}\n${truncate(job.description.replace(/\s+/g, ' '), 2000)}\n\nTHEIR FACTS:\n${facts}`,
    maxOutputTokens: 1400,
  };
}

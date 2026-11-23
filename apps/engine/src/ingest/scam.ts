import { createHash } from 'node:crypto';
import { hostOf } from './text';

/**
 * First line of scam screening: cheap rules that run on every job.
 * The AI check (scam_check) only runs on the unclear middle band, and only for
 * sources that aren't an employer's own applicant system.
 */

export interface ScamInput {
  title: string;
  company: string;
  description: string;
  applyEmail?: string | null;
  applyUrl?: string | null;
  payMaxMinor?: number | null;
  payCurrency?: string | null;
  payPeriod?: string | null;
}

export interface ScamResult {
  score: number;
  /** Internal only. Never shown to the poster, so rules can't be gamed. */
  reasons: string[];
}

export const PERSONAL_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com',
  'proton.me', 'protonmail.com', 'mail.com', 'yandex.com', 'gmx.com', 'zoho.com',
]);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 'rb.gy', 't.ly', 'is.gd', 'shorturl.at', 'linktr.ee']);

const RULES: [string, number, RegExp][] = [
  ['asks_for_money', 0.65, /\b(registration|processing|application|training|onboarding|starter[- ]?kit|equipment|activation|verification|placement|visa) fees?\b|\bpay (a |the |an )?(small |one[- ]time )?(fee|deposit)\b|\bsend (us )?(money|payment)\b|\brefundable (deposit|fee)\b|\b(buy|purchase) (your |the |a )?(own )?(equipment|laptop|starter kit|software licen[cs]e)\b/],
  ['odd_payment', 0.5, /\b(pay|payment|send|deposit)\b.{0,40}\b(bitcoin|btc|usdt|gift ?cards?|western union|moneygram|itunes)\b/],
  ['chat_only_contact', 0.35, /\b(contact|message|text|reach|apply|dm|chat with)\b( us| me| our hr| the recruiter)? (via|on|through|with) (telegram|whatsapp|signal|wechat)\b|wa\.me\/|t\.me\//],
  ['mule_or_reship', 0.55, /\b(reship\w*|package forwarding|receive (and forward )?(packages|parcels)|mystery shopper|check cashing|cash (a|the) cheque|money mule|payment processing agent|transfer (the )?funds (to|on behalf))\b/],
  ['asks_sensitive_data', 0.35, /\b(send|provide|share|submit)\b.{0,40}\b(bvn|nin number|ssn|social security number|bank (login|password|pin)|atm pin|card (details|number|pin)|otp)\b/],
  ['too_good', 0.3, /\bearn (up to )?(\$|£|€|₦|usd )?\s?\d[\d,]*\s?k? (per|a|\/|every) ?(day|hour|week)\b|\bguaranteed (income|earnings|pay)\b|\bwork (only )?\d+ hours? (a|per) (day|week) and earn\b|\bget rich\b|\bpassive income\b/],
  ['urgency', 0.12, /\b(limited slots?|slots? (are )?limited|few slots|act (fast|now)|first come,? first served|urgent(ly)? hiring.{0,20}(today|now))\b/],
  ['no_skills_big_pay', 0.2, /\bno (experience|skills?|qualifications?) (needed|required)\b.{0,120}(\$|£|€|₦|usd)\s?\d{3,}/],
];

export function screen(input: ScamInput): ScamResult {
  const text = `${input.title}\n${input.description}`.toLowerCase();
  const hits: [string, number][] = [];

  for (const [name, weight, re] of RULES) if (re.test(text)) hits.push([name, weight]);

  const emailDomain = input.applyEmail?.split('@')[1]?.toLowerCase();
  if (emailDomain && PERSONAL_MAIL.has(emailDomain)) hits.push(['personal_email', 0.15]);
  const host = hostOf(input.applyUrl);
  if (host && SHORTENERS.has(host)) hits.push(['short_link', 0.2]);
  if (host && /\b(forms\.gle|docs\.google\.com)$/.test(host) && /\b(fee|payment|bank)\b/.test(text)) hits.push(['form_asks_payment', 0.3]);

  if (input.description.length < 200) hits.push(['very_short', 0.08]);
  const letters = input.description.replace(/[^A-Za-z]/g, '');
  if (letters.length > 80 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.5) hits.push(['shouting', 0.08]);
  if ((input.description.match(/\p{Extended_Pictographic}/gu) ?? []).length > 12) hits.push(['emoji_heavy', 0.06]);

  // Pay far above the market for the kind of role.
  if (input.payMaxMinor && input.payCurrency === 'USD' && input.payPeriod === 'hour' && input.payMaxMinor > 200_00
      && /\b(data entry|typing|assistant|customer service|chat (support|moderator))\b/.test(text)) {
    hits.push(['pay_too_high', 0.35]);
  }

  const score = 1 - hits.reduce((keep, [, w]) => keep * (1 - w), 1);
  return { score: Math.round(score * 1000) / 1000, reasons: hits.map(([n]) => n) };
}

export const SCAM_BLOCK = 0.7;
export const SCAM_REVIEW = 0.35;

/** Stable fingerprint of a description, for the confirmed-scam list. */
export function textHash(description: string): string {
  const norm = description.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex');
}

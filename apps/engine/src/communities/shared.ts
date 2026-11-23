import { randomInt } from 'node:crypto';

export const PERIOD_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, yearly: 365 };

export const money = (kobo: number | string | bigint | null | undefined) => ({ amount_minor: Number(kobo ?? 0), currency: 'NGN' });

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export function randomChars(n: number) {
  return Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** "Lagos Tech Hub" → "LTH". */
export function initials(name: string) {
  const letters = name.toUpperCase().normalize('NFKD').replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('');
  return (letters || 'IJ').slice(0, 3).padEnd(2, 'X');
}

export function inviteCode(name: string) {
  return `${initials(name)}-${randomInt(1000, 10000)}`;
}

/** Single-use Selar codes: "LTH-7K4P9QXA". */
export function accessCode(name: string) {
  return `${initials(name)}-${randomChars(8)}`;
}

/** "+2348021234502" → "+234 802 *** **02", "ada@example.com" → "a**@example.com". */
export function maskTarget(target: string) {
  if (target.includes('@')) {
    const [local, domain] = target.split('@');
    return `${local[0]}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
  }
  const d = target.replace(/\D/g, '');
  return `+${d.slice(0, 3)} ${d.slice(3, 6)} *** **${d.slice(-2)}`;
}

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 86400_000);
}

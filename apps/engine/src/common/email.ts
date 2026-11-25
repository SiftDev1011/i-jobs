import { z } from 'zod';

const Email = z.email();

/** A deliverable-looking address: what SES accepts (no trailing or doubled dots, a real top-level domain). */
export function isEmail(value: string): boolean {
  return value.length <= 254 && Email.safeParse(value).success;
}

import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { FieldError, Problem } from './problem';

export function zodIssuesToErrors(issues: readonly z.core.$ZodIssue[]): FieldError[] {
  return issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
}

/** Validates and parses a value, or throws a 400 problem listing each bad field. */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw Problem.badRequest('invalid_request', 'Some fields are missing or invalid', zodIssuesToErrors(result.error.issues));
  }
  return result.data;
}

/** Use as @Body(new ZodPipe(schema)) or @Query(new ZodPipe(schema)). */
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return parseOrThrow(this.schema, value ?? {});
  }
}

export const Uuid = z.uuid();
export const E164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'Use international format, for example +2348012345678');

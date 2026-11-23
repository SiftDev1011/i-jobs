import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { Problem } from './problem';
import { zodIssuesToErrors } from './zod';

/** Turns every error into application/problem+json. Unexpected errors never leak details. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    for (const [k, v] of Object.entries(problem.headers ?? {})) res.setHeader(k, v);
    res.status(problem.status).type('application/problem+json').send(JSON.stringify(problem.toBody()));
  }

  private toProblem(e: unknown): Problem {
    if (e instanceof Problem) return e;
    if (e instanceof ZodError) {
      return Problem.badRequest('invalid_request', 'Some fields are missing or invalid', zodIssuesToErrors(e.issues));
    }
    // Body parser errors (malformed JSON, oversized body) carry a `type`, sometimes wrapped as the cause.
    const parseType = (e as { type?: string })?.type ?? ((e as { cause?: { type?: string } })?.cause?.type);
    if (parseType === 'entity.parse.failed' || (e instanceof SyntaxError && 'body' in e)) {
      return Problem.badRequest('invalid_json', 'The request body is not valid JSON');
    }
    if (parseType === 'entity.too.large') {
      return new Problem(413, 'payload_too_large', 'The request is too large');
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      // Nest re-throws body-parser's JSON errors as a plain 400 carrying the parser message.
      if (status === 400 && /JSON|Unexpected (token|end)/.test(e.message)) {
        return Problem.badRequest('invalid_json', 'The request body is not valid JSON');
      }
      const codes: Record<number, [string, string]> = {
        400: ['invalid_request', 'The request could not be read'],
        404: ['route_not_found', 'There is no endpoint at this address'],
        405: ['method_not_allowed', 'This method is not allowed here'],
        413: ['payload_too_large', 'The request is too large'],
        415: ['unsupported_media_type', 'Send JSON with Content-Type: application/json'],
      };
      const [code, title] = codes[status] ?? ['http_error', e.message];
      return new Problem(status, code, title);
    }
    return new Problem(500, 'internal_error', 'Something went wrong on our side. Try again in a moment.');
  }
}

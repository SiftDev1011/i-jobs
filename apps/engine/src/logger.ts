import { LoggerService } from '@nestjs/common';
import pino from 'pino';

export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'ijobs-engine' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Human-friendly output in development: LOG_PRETTY=true
  transport: process.env.LOG_PRETTY === 'true' ? { target: 'pino-pretty' } : undefined,
});

/** Sends Nest's own log lines through pino, so everything is JSON in production. */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, context?: string) {
    rootLogger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    rootLogger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    rootLogger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    rootLogger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    rootLogger.trace({ context }, String(message));
  }
}

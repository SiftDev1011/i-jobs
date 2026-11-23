import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config/config';
import { PinoNestLogger, rootLogger } from './logger';

/** Builds the HTTP app. Shared by main.ts and the tests so both run the same setup. */
export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: opts.logger === false ? false : undefined,
    // Signed webhooks (email worker, SES) are checked against the exact bytes received.
    rawBody: true,
  });
  const config = app.get<AppConfig>(CONFIG);
  if (opts.logger !== false) app.useLogger(new PinoNestLogger());

  // Behind Cloudflare Tunnel: trust the proxy so req.ip is the visitor's address.
  if (config.TRUST_PROXY) app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  // Amazon SNS posts JSON as text/plain.
  app.useBodyParser('text', { type: 'text/plain', limit: '256kb' });

  if (opts.logger !== false) {
    app.use(
      pinoHttp({
        logger: rootLogger,
        redact: ['req.headers.authorization', 'req.headers["x-site-key"]', 'req.headers.cookie'],
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        autoLogging: { ignore: (req) => req.url === '/v1/health' },
      }),
    );
  }

  app.enableCors({
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: false,
    exposedHeaders: ['Retry-After', 'Idempotent-Replayed'],
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  return app;
}

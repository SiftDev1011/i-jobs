import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { MailService } from '../src/messaging/mail.service';
import { SmsService } from '../src/messaging/sms.service';
import { RedisService } from '../src/redis/redis.service';
import { testDbUrl } from './env';

export interface TestCtx {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  mail: MailService;
  sms: SmsService;
  admin: Pool;
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestCtx> {
  const app = await createApp({ logger: false });
  await app.init();
  const admin = new Pool({ connectionString: testDbUrl(), max: 2, options: '-c TimeZone=UTC' });
  return {
    app,
    http: () => request(app.getHttpServer()),
    mail: app.get(MailService),
    sms: app.get(SmsService),
    admin,
    close: async () => {
      await admin.end();
      await app.close();
    },
  };
}

export function lastCode(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`No code in: ${text}`);
  return m[1];
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter++;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

/** Signs in through the real code flow and returns the tokens. */
export async function signIn(ctx: TestCtx, email = uniqueEmail()) {
  await ctx.http().post('/v1/auth/codes').send({ target: email }).expect(204);
  const mail = [...ctx.mail.outbox].reverse().find((m) => m.to === email)!;
  const res = await ctx.http().post('/v1/auth/sessions').send({ target: email, code: lastCode(mail.text) }).expect(200);
  return {
    email,
    userId: res.body.user.id as string,
    access: res.body.access_token as string,
    refresh: res.body.refresh_token as string,
    auth: { Authorization: `Bearer ${res.body.access_token}` },
  };
}

export async function flushRateLimits(ctx: TestCtx) {
  const redis = ctx.app.get(RedisService).client;
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
}

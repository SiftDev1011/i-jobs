import { Body, Controller, Headers, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/actor';
import { hmacHex, safeEqual } from '../common/crypto';
import { Problem } from '../common/problem';
import { ZodPipe } from '../common/zod';
import { AppConfig, CONFIG } from '../config/config';
import { InboundService } from './inbound.service';
import { isSubscribeUrl, SnsMessage, SnsVerifier } from './sns';

const InboundBody = z.object({
  to: z.string().min(3).max(320),
  from: z.string().min(3).max(320),
  subject: z.string().max(2000).optional(),
  message_id: z.string().max(500).optional(),
  in_reply_to: z.string().max(500).optional(),
  raw_key: z.string().min(1).max(500),
  text: z.string().max(50_000).optional(),
});

/** Incoming webhooks: the Cloudflare email worker and Amazon SES (through SNS). */
@Controller('hooks')
export class HooksController {
  private readonly logger = new Logger('Hooks');
  readonly sns = new SnsVerifier();

  constructor(
    private readonly inbound: InboundService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('inbound-email')
  @HttpCode(202)
  async inboundEmail(@Req() req: RawBodyRequest<Request>, @Headers('x-ijobs-signature') signature: string | undefined, @Body() raw: unknown) {
    const secret = this.config.INBOUND_EMAIL_SECRET;
    const expected = secret && req.rawBody ? `sha256=${hmacHex(secret, req.rawBody)}` : null;
    if (!expected || !signature || !safeEqual(signature, expected)) throw Problem.unauthorized('bad_signature', 'The signature does not match');
    const body = new ZodPipe(InboundBody).transform(raw);
    await this.inbound.receive(body);
    return { status: 'queued' };
  }

  @Public()
  @Post('ses')
  @HttpCode(200)
  async ses(@Body() body: unknown) {
    let m: SnsMessage;
    try {
      m = (typeof body === 'string' ? JSON.parse(body) : body) as SnsMessage;
    } catch {
      throw Problem.badRequest('invalid_json', 'The request body is not valid JSON');
    }
    if (!this.config.SES_SNS_SKIP_VERIFY && !(await this.sns.verify(m))) throw Problem.unauthorized('bad_signature', 'The SNS signature does not match');
    const topics = this.config.SES_SNS_TOPIC_ARNS.split(',').map((t) => t.trim()).filter(Boolean);
    if (topics.length && !topics.includes(m.TopicArn)) throw Problem.forbidden('unknown_topic', 'This SNS topic is not allowed');

    if (m.Type === 'SubscriptionConfirmation') {
      if (!isSubscribeUrl(m.SubscribeURL)) throw Problem.badRequest('bad_subscribe_url', 'Not an SNS address');
      await fetch(m.SubscribeURL);
      this.logger.log(`Confirmed SNS subscription to ${m.TopicArn}`);
      return { status: 'subscribed' };
    }
    if (m.Type !== 'Notification') return { status: 'ignored' };
    let event: unknown;
    try {
      event = JSON.parse(m.Message);
    } catch {
      return { status: 'ignored' };
    }
    return { status: await this.inbound.sesEvent(event) };
  }
}

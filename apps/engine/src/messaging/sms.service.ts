import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';

export interface OutgoingSms {
  to: string; // E.164
  text: string;
}

/**
 * SMS for sign-in codes, trial checks and phone invites.
 *
 * SMS_DRIVER=none runs i-jobs email-only: phone sign-in, phone invites and free
 * weeks (which are tied to a checked phone number) are all turned off, and
 * GET /v1/features tells the apps so they hide them.
 *
 * SMS_DRIVER=termii sends through Termii's "send message" endpoint on the DND
 * route, which reaches Nigerian numbers that block promotional SMS. Check the
 * request format against Termii's current docs when you set up the account.
 * SMS_DRIVER=console logs instead and keeps an outbox for tests.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');
  readonly outbox: OutgoingSms[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** False when SMS_DRIVER=none: nothing can be texted. */
  get enabled() {
    return this.config.SMS_DRIVER !== 'none';
  }

  async send(sms: OutgoingSms): Promise<void> {
    if (!this.enabled) {
      // Callers check `enabled` first; this only guards against a missed check.
      this.logger.warn(`SMS is off (SMS_DRIVER=none); not sent to ${sms.to.slice(0, 5)}…`);
      return;
    }
    if (this.config.SMS_DRIVER === 'console') {
      this.outbox.push(sms);
      if (this.config.NODE_ENV !== 'test') this.logger.log(`[console sms] to=${sms.to} ${sms.text}`);
      return;
    }
    const res = await fetch(`${this.config.TERMII_BASE_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.config.TERMII_API_KEY,
        to: sms.to.replace(/^\+/, ''),
        from: this.config.TERMII_SENDER_ID,
        sms: sms.text,
        type: 'plain',
        channel: 'dnd',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SMS provider returned ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

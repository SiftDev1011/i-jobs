import { Controller, Get, Header, Inject } from '@nestjs/common';
import { Public } from '../auth/actor';
import { AppConfig, CONFIG } from '../config/config';
import { SmsService } from '../messaging/sms.service';

/**
 * What this engine can do, so apps show only what works. Texts are optional (SMS_DRIVER=none):
 * without them there is no phone sign-in, no phone invites and no free weeks. `demo_payments` is on
 * only with the fake Paga driver (never in production): checkout is the web app's /demo-pay page.
 */
@Controller('features')
export class FeaturesController {
  constructor(private readonly sms: SmsService, @Inject(CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  features() {
    const texts = this.sms.enabled;
    return { phone_sign_in: texts, phone_invites: texts, free_weeks: texts, demo_payments: this.config.PAGA_DRIVER === 'fake' };
  }
}

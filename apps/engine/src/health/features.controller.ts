import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/actor';
import { SmsService } from '../messaging/sms.service';

/**
 * What this engine can do, so apps show only what works. Texts are optional (SMS_DRIVER=none):
 * without them there is no phone sign-in, no phone invites and no free weeks.
 */
@Controller('features')
export class FeaturesController {
  constructor(private readonly sms: SmsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  features() {
    const texts = this.sms.enabled;
    return { phone_sign_in: texts, phone_invites: texts, free_weeks: texts };
  }
}

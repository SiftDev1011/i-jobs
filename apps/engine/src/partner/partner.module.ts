import { Module } from '@nestjs/common';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';
import { WebhooksService } from './webhooks.service';

/** Partner sites: linking their users, and webhooks back to them. */
@Module({
  controllers: [PartnerController],
  providers: [PartnerService, WebhooksService],
  exports: [WebhooksService],
})
export class PartnerModule {}

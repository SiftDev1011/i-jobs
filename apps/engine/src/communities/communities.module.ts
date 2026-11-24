import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PagaClient } from '../money/paga';
import { PayoutsService } from '../money/payouts.service';
import { AdminCommunitiesService } from './admin-communities.service';
import { CommunitiesController } from './communities.controller';
import { DemoPaymentsController } from './demo-payments.controller';
import { MembershipService } from './membership.service';
import { OwnerService } from './owner.service';

/** Communities, owners, memberships, Selar codes, Paga payments, the ledger and payouts. */
@Module({
  imports: [AiModule],
  controllers: [CommunitiesController, DemoPaymentsController],
  providers: [OwnerService, MembershipService, AdminCommunitiesService, PayoutsService, PagaClient],
  exports: [OwnerService, MembershipService, PayoutsService, PagaClient],
})
export class CommunitiesModule {}

import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { AiModule } from '../ai/ai.module';
import { JobsModule } from '../jobs/jobs.module';
import { ApplyService } from './apply.service';
import { ApplyingController } from './applying.controller';
import { HooksController } from './hooks.controller';
import { InboundService } from './inbound.service';
import { PlannerService } from './planner.service';
import { RelayService } from './relay.service';
import { SenderService } from './sender.service';
import { VisitorService } from './visitor.service';

/** The apply queue, autopilot planning and sending, replies, check-ins and visitor applies. */
@Module({
  imports: [AccountModule, AiModule, JobsModule],
  controllers: [ApplyingController, HooksController],
  providers: [ApplyService, InboundService, PlannerService, RelayService, SenderService, VisitorService],
  exports: [ApplyService, InboundService, PlannerService, RelayService, SenderService],
})
export class ApplyingModule {}

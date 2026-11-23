import { Module } from '@nestjs/common';
import { AdminModerationController } from './admin.controller';
import { ModerationService } from './moderation.service';

/** The staff review queue. */
@Module({
  controllers: [AdminModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class AdminModule {}

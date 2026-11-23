import { Module } from '@nestjs/common';
import { DataRequestsService } from './data-requests.service';
import { AdminDataRequestsController } from './privacy.controller';

/** Data requests: exports, deletion, and the staff view. */
@Module({
  controllers: [AdminDataRequestsController],
  providers: [DataRequestsService],
  exports: [DataRequestsService],
})
export class PrivacyModule {}

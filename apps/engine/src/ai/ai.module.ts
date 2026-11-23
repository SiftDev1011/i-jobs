import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

/** One AiService for the whole process, so budget bookkeeping and test fakes are shared. */
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}

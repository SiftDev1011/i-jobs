import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MatchingModule } from '../matching/matching.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Help search, the support assistant and tickets. */
@Module({
  imports: [AiModule, MatchingModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}

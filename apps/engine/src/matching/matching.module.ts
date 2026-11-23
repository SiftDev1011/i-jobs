import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { MatchService } from './match.service';

@Module({
  providers: [EmbeddingService, MatchService],
  exports: [EmbeddingService, MatchService],
})
export class MatchingModule {}

import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AppConfig, CONFIG } from '../config/config';
import { Http } from './http';
import { IngestService } from './ingest.service';
import { PipelineService } from './pipeline.service';
import { UpkeepService } from './upkeep.service';

/** Job sources → raw postings → jobs, plus expiry and link checks. Used by the worker (and tests). */
@Module({
  imports: [AiModule],
  providers: [
    { provide: Http, inject: [CONFIG], useFactory: (c: AppConfig) => new Http(c.INGEST_USER_AGENT, c.INGEST_HTTP_TIMEOUT_MS) },
    IngestService,
    PipelineService,
    UpkeepService,
  ],
  exports: [Http, AiModule, IngestService, PipelineService, UpkeepService],
})
export class IngestModule {}

import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { AiModule } from '../ai/ai.module';
import { JobsModule } from '../jobs/jobs.module';
import { MatchingModule } from '../matching/matching.module';
import { CvParseService } from './cv-parse.service';
import { MatchesService } from './matches.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/** CV, profile, matches, autopilot rules and partner course catalogues. */
@Module({
  imports: [AccountModule, AiModule, JobsModule, MatchingModule],
  controllers: [ProfileController],
  providers: [ProfileService, CvParseService, MatchesService],
  exports: [ProfileService, CvParseService, MatchesService, MatchingModule],
})
export class ProfileModule {}

import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AtsKeyChecker } from './ats-check';
import { EmployersController } from './employers.controller';
import { EmployersService } from './employers.service';

/** Employer verification, direct job posts and ATS connections. */
@Module({
  imports: [JobsModule],
  controllers: [EmployersController],
  providers: [EmployersService, AtsKeyChecker],
  exports: [EmployersService],
})
export class EmployersModule {}

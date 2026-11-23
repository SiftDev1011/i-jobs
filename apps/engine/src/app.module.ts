import { DevFilesController } from './storage/dev-files.controller';
import { Module } from '@nestjs/common';
import { ProfileModule } from './profile/profile.module';
import { ApplyingModule } from './applying/applying.module';
import { CommunitiesModule } from './communities/communities.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { EmployersModule } from './employers/employers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PartnerModule } from './partner/partner.module';
import { PrivacyModule } from './privacy/privacy.module';
import { SupportModule } from './support/support.module';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccountModule } from './account/account.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { IdempotencyInterceptor } from './common/idempotency';
import { ProblemFilter } from './common/problem.filter';
import { CoreModule } from './core.module';
import { FeaturesController } from './health/features.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    CoreModule, AuthModule, AccountModule, JobsModule, ProfileModule, ApplyingModule, CommunitiesModule,
    NotificationsModule, SupportModule, AdminModule, PartnerModule, EmployersModule, PrivacyModule,
  ],
  controllers: [HealthController, FeaturesController, DevFilesController],
  providers: [
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}

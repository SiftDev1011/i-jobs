import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core.module';
import { IngestModule } from './ingest/ingest.module';
import { JobHandlers } from './ingest/scheduler';
import { MaintenanceService } from './maintenance/maintenance.service';
import { ProfileModule } from './profile/profile.module';
import { ApplyingModule } from './applying/applying.module';
import { CommunitiesModule } from './communities/communities.module';
import { EmployersModule } from './employers/employers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PartnerModule } from './partner/partner.module';
import { PrivacyModule } from './privacy/privacy.module';

/** Everything the background worker needs. Later milestones add their processors here. */
@Module({
  imports: [CoreModule, AuthModule, IngestModule, ProfileModule, ApplyingModule, CommunitiesModule, NotificationsModule, PartnerModule, PrivacyModule, EmployersModule],
  providers: [MaintenanceService, JobHandlers],
  exports: [JobHandlers],
})
export class WorkerModule {}

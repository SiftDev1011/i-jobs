import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { MatchService } from '../matching/match.service';
import { CvParseService } from '../profile/cv-parse.service';
import { ApplyService } from '../applying/apply.service';
import { InboundService } from '../applying/inbound.service';
import { PlannerService } from '../applying/planner.service';
import { SenderService } from '../applying/sender.service';
import { MembershipService } from '../communities/membership.service';
import { OwnerService } from '../communities/owner.service';
import { PayoutsService } from '../money/payouts.service';
import { EmployersService } from '../employers/employers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../partner/webhooks.service';
import { DataRequestsService } from '../privacy/data-requests.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { FetchUnit, IngestService } from './ingest.service';
import { PipelineService } from './pipeline.service';
import { UpkeepService } from './upkeep.service';

/** Repeating schedules. Times are UTC. */
export const SCHEDULES = [
  { queue: QUEUES.ingest, id: 'ingest-tick', name: 'tick', pattern: '*/5 * * * *' },
  { queue: QUEUES.process, id: 'process-tick', name: 'batch', pattern: '*/2 * * * *' },
  { queue: QUEUES.maintenance, id: 'hourly', name: 'hourly', pattern: '7 * * * *' },
  { queue: QUEUES.maintenance, id: 'link-checks', name: 'links', pattern: '37 * * * *' },
  { queue: QUEUES.match, id: 'match-new-jobs', name: 'new-jobs', pattern: '*/10 * * * *' },
  { queue: QUEUES.match, id: 'match-nightly', name: 'nightly', pattern: '30 2 * * *' },
  // Autopilot: plan every 15 minutes (catches the new day's caps at 00:00), send every minute.
  { queue: QUEUES.send, id: 'plan', name: 'plan', pattern: '*/15 * * * *' },
  { queue: QUEUES.send, id: 'send-due', name: 'due', pattern: '* * * * *' },
  // Check-ins at 09:00 Lagos.
  { queue: QUEUES.maintenance, id: 'checkins', name: 'checkins', pattern: '0 8 * * *' },
  // Memberships: trials, renewals and reminders hourly; fraud checks daily; payouts on the 1st, 09:00 Lagos.
  { queue: QUEUES.maintenance, id: 'memberships', name: 'memberships', pattern: '17 * * * *' },
  { queue: QUEUES.maintenance, id: 'fraud', name: 'fraud', pattern: '40 3 * * *' },
  { queue: QUEUES.maintenance, id: 'payouts', name: 'payouts', pattern: '0 8 1 * *' },
  // Platform: notification emails, partner webhooks, data requests, employer jobs that are full.
  { queue: QUEUES.mail, id: 'notifications', name: 'notifications', pattern: '*/2 * * * *' },
  { queue: QUEUES.webhooks, id: 'webhooks', name: 'tick', pattern: '* * * * *' },
  { queue: QUEUES.maintenance, id: 'data-requests', name: 'data-requests', pattern: '*/15 * * * *' },
  { queue: QUEUES.maintenance, id: 'full-jobs', name: 'full-jobs', pattern: '*/10 * * * *' },
] as const;

/** What each queue does with each job name. The worker wires these to BullMQ. */
@Injectable()
export class JobHandlers {
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly queues: QueueService,
    private readonly ingest: IngestService,
    private readonly pipeline: PipelineService,
    private readonly upkeep: UpkeepService,
    private readonly maintenance: MaintenanceService,
    private readonly cvParse: CvParseService,
    private readonly matching: MatchService,
    private readonly planner: PlannerService,
    private readonly sender: SenderService,
    private readonly inbound: InboundService,
    private readonly apply: ApplyService,
    private readonly memberships: MembershipService,
    private readonly owners: OwnerService,
    private readonly payouts: PayoutsService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly dataRequests: DataRequestsService,
    private readonly employers: EmployersService,
  ) {}

  handlers(ingestEnabled: boolean): Record<string, (job: Job) => Promise<unknown>> {
    return {
      [`${QUEUES.ingest}:tick`]: () => (ingestEnabled ? this.tick() : Promise.resolve({ disabled: true })),
      [`${QUEUES.ingest}:fetch`]: (job) => this.fetch(job.data as FetchUnit),
      [`${QUEUES.process}:batch`]: () => this.pipeline.processBatch(50),
      [`${QUEUES.maintenance}:hourly`]: async () => ({ ...(await this.maintenance.hourly()), jobs_expired: await this.upkeep.expire() }),
      [`${QUEUES.maintenance}:links`]: () => this.upkeep.checkLinks(),
      [`${QUEUES.ai}:cv_parse`]: (job) => this.cvParse.run((job.data as { workId: string }).workId),
      [`${QUEUES.match}:user`]: async (job) => {
        const userId = (job.data as { userId: string }).userId;
        return { ...(await this.matching.matchMember(userId)), ...(await this.planner.planMember(userId)) };
      },
      [`${QUEUES.match}:new-jobs`]: async () => ({ embedded: await this.matching.embedJobs(), ...(await this.matching.matchNewJobs()) }),
      [`${QUEUES.match}:nightly`]: () => this.matching.queueStaleMembers(),
      [`${QUEUES.send}:plan`]: () => this.planner.planDue(),
      [`${QUEUES.send}:due`]: () => this.sender.sendDue(),
      [`${QUEUES.ai}:reply_sort`]: (job) => this.inbound.sort((job.data as { messageId: string }).messageId),
      [`${QUEUES.ai}:apply_pack`]: (job) => this.apply.buildPack((job.data as { workId: string }).workId),
      [`${QUEUES.maintenance}:checkins`]: () => this.apply.checkins(),
      [`${QUEUES.maintenance}:memberships`]: () => this.memberships.lifecycle(),
      [`${QUEUES.maintenance}:fraud`]: () => this.payouts.fraudChecks(),
      [`${QUEUES.maintenance}:payouts`]: () => this.payouts.createMonthly(),
      [`${QUEUES.mail}:invites`]: (job) => this.owners.deliverInvites((job.data as { communityId: string }).communityId),
      [`${QUEUES.mail}:notifications`]: () => this.notifications.deliverEmails(),
      [`${QUEUES.webhooks}:tick`]: async () => ({ queued: await this.webhooks.collect(), ...(await this.webhooks.deliver()) }),
      [`${QUEUES.maintenance}:data-requests`]: () => this.dataRequests.processDue(),
      [`${QUEUES.maintenance}:full-jobs`]: () => this.employers.closeFullJobs(),
      [`${QUEUES.maintenance}:employer-website`]: (job) => this.employers.checkWebsite((job.data as { employerId: string }).employerId),
    };
  }

  /** Queue a fetch for every source and board that's due. */
  async tick() {
    const units = await this.ingest.dueUnits();
    let queued = 0;
    for (const unit of units) {
      if (!(await this.ingest.claim(unit))) continue;
      await this.queues.add(QUEUES.ingest, 'fetch', unit, { attempts: 1, removeOnComplete: { age: 3600, count: 1000 } });
      queued++;
    }
    return { due: units.length, queued };
  }

  async fetch(unit: FetchUnit) {
    try {
      const stats = await this.ingest.fetchUnit(unit);
      if (stats.created || stats.updated) {
        // Process soon rather than waiting for the next tick. One per minute is enough.
        const minute = Math.floor(Date.now() / 60_000);
        await this.queues.add(QUEUES.process, 'batch', {}, { jobId: `batch-${minute}`, delay: 5_000 });
      }
      return stats;
    } finally {
      await this.ingest.release(unit);
    }
  }
}

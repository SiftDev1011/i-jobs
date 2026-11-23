import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppConfig, CONFIG } from './config/config';
import { JobHandlers, SCHEDULES } from './ingest/scheduler';
import { PinoNestLogger, rootLogger } from './logger';
import { bullConnection, QUEUES, QueueName, QueueService } from './queues/queue.service';
import { WorkerModule } from './worker.module';

/** How many jobs of each queue run at once. Processing is one at a time to keep AI calls in line. */
const CONCURRENCY: Partial<Record<QueueName, number>> = {
  [QUEUES.maintenance]: 1,
  [QUEUES.ingest]: 3,
  [QUEUES.process]: 1,
  [QUEUES.ai]: 1,
  [QUEUES.match]: 2,
  [QUEUES.send]: 1,
  [QUEUES.mail]: 1,
  [QUEUES.webhooks]: 1,
};

/**
 * The background worker: one process that runs every queue.
 * Each queue gets its own concurrency so a burst in one never starves the others.
 */
async function main() {
  const ctx = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger() });
  const config = ctx.get<AppConfig>(CONFIG);
  const queues = ctx.get(QueueService);
  const handlers = ctx.get(JobHandlers).handlers(config.INGEST_ENABLED);

  const workers = (Object.keys(CONCURRENCY) as QueueName[]).map(
    (name) =>
      new Worker(
        name,
        async (job) => {
          const handler = handlers[`${job.queueName}:${job.name}`];
          if (!handler) throw new Error(`No handler for ${job.queueName}:${job.name}`);
          return handler(job);
        },
        { connection: bullConnection(config.REDIS_URL), concurrency: CONCURRENCY[name] },
      ),
  );

  for (const w of workers) {
    w.on('failed', (job, err) => rootLogger.error({ queue: w.name, job: job?.name, id: job?.id, err: err.message }, 'Job failed'));
  }

  // Repeating jobs. Re-registering on every start is safe; BullMQ keeps one schedule per id.
  for (const s of SCHEDULES) {
    await queues.queue(s.queue).upsertJobScheduler(s.id, { pattern: s.pattern }, { name: s.name, opts: { attempts: 1 } });
  }

  rootLogger.info(`Worker running queues: ${workers.map((w) => w.name).join(', ')}${config.INGEST_ENABLED ? '' : ' (job fetching is off)'}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    rootLogger.info('Worker stopping');
    await Promise.all(workers.map((w) => w.close()));
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  rootLogger.fatal(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});

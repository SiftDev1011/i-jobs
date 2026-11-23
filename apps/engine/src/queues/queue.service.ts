import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/config';

/** Every background queue. Workers for each are started by worker.ts. */
export const QUEUES = {
  maintenance: 'maintenance',
  ingest: 'ingest',
  process: 'process',
  ai: 'ai',
  match: 'match',
  send: 'send',
  mail: 'mail',
  webhooks: 'webhooks',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** A Redis connection set up the way BullMQ requires. */
export function bullConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.connection = bullConnection(config.REDIS_URL);
  }

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 24 * 3600, count: 5000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  add<T>(name: QueueName, jobName: string, data: T, opts?: JobsOptions) {
    return this.queue(name).add(jobName, data, opts);
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.connection.disconnect();
  }
}

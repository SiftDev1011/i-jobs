import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/config';

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(CONFIG) config: AppConfig) {
    // BullMQ needs maxRetriesPerRequest: null on connections it uses; we keep a separate one per queue.
    this.client = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }

  /** Fixed-window limiter: at most `limit` hits per `windowSeconds` for `key`. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateResult> {
    const k = `rl:${key}`;
    const [[, count], [, ttl]] = (await this.client
      .multi()
      .incr(k)
      .ttl(k)
      .exec()) as [[null, number], [null, number]];
    if (ttl < 0) await this.client.expire(k, windowSeconds);
    const retry = ttl > 0 ? ttl : windowSeconds;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: count <= limit ? 0 : retry };
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}

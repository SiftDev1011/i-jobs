import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/actor';
import { Db } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

/** For the uptime checker and Docker: 200 when the database and Redis answer, 503 otherwise. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([this.db.ping(), this.redis.ping()]);
    const ok = database && redis;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks: { database, redis } };
  }
}

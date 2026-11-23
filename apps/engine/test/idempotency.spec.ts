import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { CurrentActor, Actor } from '../src/auth/actor';
import { AuthGuard } from '../src/auth/auth.guard';
import { TokensService } from '../src/auth/tokens.service';
import { Idempotent, IdempotencyInterceptor } from '../src/common/idempotency';
import { ProblemFilter } from '../src/common/problem.filter';
import { CoreModule } from '../src/core.module';
import { SITE_KEYS, testDbUrl } from './env';

let runs = 0;

@Controller('demo')
class DemoController {
  @Idempotent()
  @Post('charge')
  charge(@CurrentActor() actor: Actor, @Body() body: { amount: number }) {
    runs++;
    return { charged: body.amount, run: runs, site: actor.siteId };
  }
}

@Module({
  imports: [CoreModule],
  controllers: [DemoController],
  providers: [
    TokensService,
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
class DemoModule {}

describe('Idempotency-Key', () => {
  let app: INestApplication;
  const key = SITE_KEYS['remote-hustle'];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [DemoModule] }).compile();
    app = mod.createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(async () => {
    const admin = new Pool({ connectionString: testDbUrl() });
    await admin.query(`DELETE FROM idempotency_keys`);
    await admin.end();
    await app.close();
  });

  it('requires the header', async () => {
    const res = await http().post('/demo/charge').set('X-Site-Key', key).send({ amount: 5 }).expect(400);
    expect(res.body.code).toBe('idempotency_key_required');
  });

  it('replays the first answer for a retry and never runs twice', async () => {
    const first = await http().post('/demo/charge').set('X-Site-Key', key).set('Idempotency-Key', 'k-1').send({ amount: 5 }).expect(201);
    const retry = await http().post('/demo/charge').set('X-Site-Key', key).set('Idempotency-Key', 'k-1').send({ amount: 5 }).expect(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(runs).toBe(1);
  });

  it('refuses the same key for a different request', async () => {
    const res = await http().post('/demo/charge').set('X-Site-Key', key).set('Idempotency-Key', 'k-1').send({ amount: 9 }).expect(422);
    expect(res.body.code).toBe('idempotency_key_reused');
  });

  it('keys are separate per caller', async () => {
    await http().post('/demo/charge').set('X-Site-Key', SITE_KEYS.school1).set('Idempotency-Key', 'k-1').send({ amount: 9 }).expect(201);
    expect(runs).toBe(2);
  });
});

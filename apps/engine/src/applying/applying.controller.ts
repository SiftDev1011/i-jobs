import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, userIdOf } from '../auth/actor';
import { Uuid, ZodPipe } from '../common/zod';
import { ApplyService, Who } from './apply.service';
import { VisitorService } from './visitor.service';

const STATUSES = ['scheduled', 'sending', 'sent', 'failed', 'cancelled', 'replied', 'interview', 'rejected', 'offer', 'hired', 'no_response'] as const;
const list = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(','))), z.array(item).max(11).optional());
const Page = { cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) };

const who = (actor: Actor): Who => ({ userId: userIdOf(actor), siteId: actor.siteId!, partner: actor.kind === 'site' });

@Controller()
export class ApplyingController {
  constructor(
    private readonly apply: ApplyService,
    private readonly visitors: VisitorService,
  ) {}

  @Get('me/queue')
  queue(@CurrentActor() actor: Actor, @Query(new ZodPipe(z.object(Page))) q: { cursor?: string; limit: number }) {
    return this.apply.queue(userIdOf(actor), actor.siteId!, q.cursor, q.limit);
  }

  @Post('me/queue/:jobId/pack')
  async pack(@CurrentActor() actor: Actor, @Param('jobId', new ZodPipe(Uuid)) jobId: string, @Res({ passthrough: true }) res: Response) {
    const out = await this.apply.pack(userIdOf(actor), actor.siteId!, jobId);
    res.status(out.status);
    return out.body;
  }

  @Post('me/queue/:jobId/applied')
  applied(@CurrentActor() actor: Actor, @Param('jobId', new ZodPipe(Uuid)) jobId: string) {
    return this.apply.markApplied(who(actor), jobId);
  }

  @Get('me/applications')
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(z.object({ status: list(z.enum(STATUSES)), ...Page }))) q: { status?: string[]; cursor?: string; limit: number }) {
    return this.apply.list(who(actor), q);
  }

  @Get('me/applications/summary')
  summary(@CurrentActor() actor: Actor, @Query(new ZodPipe(z.object({ date: z.iso.date().optional() }))) q: { date?: string }) {
    return this.apply.summary(who(actor), q.date);
  }

  @Get('applications/:applicationId')
  detail(@CurrentActor() actor: Actor, @Param('applicationId', new ZodPipe(Uuid)) id: string) {
    return this.apply.detail(who(actor), id);
  }

  @Post('applications/:applicationId/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('applicationId', new ZodPipe(Uuid)) id: string) {
    return this.apply.cancel(who(actor), id);
  }

  @Post('applications/:applicationId/checkins/:checkinId')
  @HttpCode(200)
  checkin(
    @CurrentActor() actor: Actor,
    @Param('applicationId', new ZodPipe(Uuid)) id: string,
    @Param('checkinId', new ZodPipe(Uuid)) checkinId: string,
    @Body(new ZodPipe(z.object({ answer: z.enum(['heard_back', 'interview', 'no_reply_yet', 'rejected', 'hired', 'did_not_apply']) }))) body: { answer: string },
  ) {
    return this.apply.answerCheckin(who(actor), id, checkinId, body.answer);
  }

  @Auth('site')
  @Post('visitor/codes')
  @HttpCode(204)
  async visitorCode(@CurrentActor() actor: Actor, @Body(new ZodPipe(z.object({ email: z.email().max(254), device_hash: z.string().min(8).max(128), ip: z.string().max(64).optional() }))) body: { email: string; device_hash: string; ip?: string }) {
    await this.visitors.sendCode(actor.siteId!, body);
  }

  @Auth('site')
  @Post('visitor/applies')
  @HttpCode(200)
  visitorApply(@CurrentActor() actor: Actor, @Body(new ZodPipe(z.object({ email: z.email().max(254), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), job_id: Uuid }))) body: { email: string; code: string; job_id: string }) {
    return this.visitors.apply(actor.siteId!, body);
  }
}

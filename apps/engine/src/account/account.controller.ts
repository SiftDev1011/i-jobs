import { Body, Controller, Get, HttpCode, Ip, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, Public, userIdOf } from '../auth/actor';
import { E164, ZodPipe } from '../common/zod';
import { AccountService } from './account.service';

const UpdateMe = z
  .object({
    full_name: z.string().trim().min(1).max(120).optional(),
    phone: E164.optional(),
    date_of_birth: z.iso.date().optional(),
  })
  .strict();

const RecordConsent = z.object({
  purpose: z.enum([
    'terms', 'privacy', 'matching', 'autopilot', 'reply_reading',
    'cross_site_linking', 'cross_site_marketing', 'training_data',
  ]),
  granted: z.boolean(),
  policy_version: z.string().min(1).max(40),
});

const GuardianRequest = z.object({
  guardian_name: z.string().trim().min(1).max(120),
  guardian_email: z.email(),
});

const GuardianDecision = z.object({
  token: z.string().min(20),
  decision: z.enum(['approve', 'decline']),
});

const DataRequestInput = z.object({
  type: z.enum(['export', 'delete', 'correct', 'human_review']),
  details: z.string().max(2000).optional(),
});

@Controller()
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.account.getMe(userIdOf(actor), actor.siteId!);
  }

  @Patch('me')
  update(@CurrentActor() actor: Actor, @Body(new ZodPipe(UpdateMe)) body: z.infer<typeof UpdateMe>) {
    return this.account.updateMe(userIdOf(actor), actor.siteId!, body);
  }

  @Get('me/consents')
  consents(@CurrentActor() actor: Actor) {
    return this.account.listConsents(userIdOf(actor));
  }

  @Post('me/consents')
  recordConsent(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(RecordConsent)) body: z.infer<typeof RecordConsent>,
    @Ip() ip: string,
  ) {
    return this.account.recordConsent(userIdOf(actor), actor.siteId!, body, ip);
  }

  @Post('me/guardian')
  @HttpCode(202)
  async guardian(@CurrentActor() actor: Actor, @Body(new ZodPipe(GuardianRequest)) body: z.infer<typeof GuardianRequest>) {
    await this.account.requestGuardianApproval(userIdOf(actor), body);
    return { status: 'sent' };
  }

  @Public()
  @Post('guardian/decision')
  @HttpCode(200)
  guardianDecision(@Body(new ZodPipe(GuardianDecision)) body: z.infer<typeof GuardianDecision>) {
    return this.account.decideGuardian(body.token, body.decision === 'approve');
  }

  @Get('me/data-requests')
  dataRequests(@CurrentActor() actor: Actor) {
    return this.account.listDataRequests(userIdOf(actor));
  }

  @Auth('required')
  @Post('me/data-requests')
  createDataRequest(@CurrentActor() actor: Actor, @Body(new ZodPipe(DataRequestInput)) body: z.infer<typeof DataRequestInput>) {
    return this.account.createDataRequest(userIdOf(actor), body);
  }
}

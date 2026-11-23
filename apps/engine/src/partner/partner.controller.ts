import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor } from '../auth/actor';
import { Uuid, ZodPipe } from '../common/zod';
import { PartnerService } from './partner.service';
import { EVENT_TYPES, WebhooksService } from './webhooks.service';

const LinkInput = z.object({
  external_user_id: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  email_verified: z.boolean(),
  full_name: z.string().trim().max(120).optional(),
  date_of_birth: z.iso.date().optional(),
  completed_trainings: z.array(z.string().trim().min(1).max(100)).max(500).optional(),
}).strict();

const WebhookInput = z.object({
  url: z.url().max(500),
  events: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length),
}).strict();

const Token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'This link is not valid');

@Controller()
export class PartnerController {
  constructor(
    private readonly partner: PartnerService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Auth('site')
  @Post('partner/users')
  @HttpCode(200)
  link(@CurrentActor() actor: Actor, @Body(new ZodPipe(LinkInput)) body: z.infer<typeof LinkInput>) {
    return this.partner.link(actor.siteId!, body);
  }

  /** The member, signed in to i-jobs, sees who wants to link and agrees or says no. */
  @Auth('user')
  @Get('partner/links/:token')
  preview(@CurrentActor() actor: Actor, @Param('token', new ZodPipe(Token)) token: string) {
    return this.partner.preview(actor.userId!, token);
  }

  @Auth('user')
  @Post('partner/links/:token/accept')
  @HttpCode(200)
  accept(@CurrentActor() actor: Actor, @Param('token', new ZodPipe(Token)) token: string) {
    return this.partner.accept(actor.userId!, token);
  }

  @Auth('user')
  @Post('partner/links/:token/decline')
  @HttpCode(204)
  async decline(@CurrentActor() actor: Actor, @Param('token', new ZodPipe(Token)) token: string) {
    await this.partner.decline(actor.userId!, token);
  }

  @Auth('site')
  @Get('partner/webhooks')
  listWebhooks(@CurrentActor() actor: Actor) {
    return this.webhooks.list(actor.siteId!);
  }

  @Auth('site')
  @Post('partner/webhooks')
  @HttpCode(201)
  createWebhook(@CurrentActor() actor: Actor, @Body(new ZodPipe(WebhookInput)) body: z.infer<typeof WebhookInput>) {
    return this.webhooks.create(actor.siteId!, body);
  }

  @Auth('site')
  @Delete('partner/webhooks/:endpointId')
  @HttpCode(204)
  async deleteWebhook(@CurrentActor() actor: Actor, @Param('endpointId', new ZodPipe(Uuid)) id: string) {
    await this.webhooks.remove(actor.siteId!, id);
  }
}

import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, Public, requireRole, userIdOf } from '../auth/actor';
import { Problem } from '../common/problem';
import { Uuid, ZodPipe } from '../common/zod';
import { RedisService } from '../redis/redis.service';
import { SitesService } from '../sites/sites.service';
import { SupportService } from './support.service';

const SearchQuery = z.object({ q: z.string().trim().min(2).max(200) });
const AskInput = z.object({ question: z.string().trim().min(3).max(1000) }).strict();
const TicketInput = z.object({
  subject: z.string().trim().min(3).max(140),
  category: z.enum(['payment', 'scam_report', 'data_request', 'account', 'other']).default('other'),
  message: z.string().trim().min(3).max(5000),
}).strict();
const MessageInput = z.object({ body: z.string().trim().min(1).max(5000) }).strict();
const StaffReply = z.object({ body: z.string().trim().min(1).max(5000), resolve: z.boolean().default(false) }).strict();
const StaffQuery = z.object({ status: z.enum(['open', 'bot_answered', 'waiting_human', 'resolved']).optional() });

const STAFF = ['admin', 'support', 'moderator', 'finance', 'dpo'];

@Controller()
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly sites: SitesService,
    private readonly redis: RedisService,
  ) {}

  /** Anyone can search the help articles; signed-out visitors see the i-jobs ones. */
  @Public()
  @Get('help/search')
  async search(@CurrentActor() actor: Actor, @Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>) {
    const siteId = actor.siteId ?? (await this.sites.ijobs()).id;
    return this.support.search(siteId, q.q);
  }

  @Post('help/ask')
  async ask(@CurrentActor() actor: Actor, @Body(new ZodPipe(AskInput)) body: z.infer<typeof AskInput>, @Res({ passthrough: true }) res: Response) {
    const userId = userIdOf(actor);
    const r = await this.redis.hit(`help-ask:${userId}`, 20, 3600);
    if (!r.allowed) throw Problem.tooMany(r.retryAfterSeconds, 'You have asked a lot of questions this hour. Try again later or open a ticket.');
    const out = await this.support.ask(userId, actor.siteId!, body.question);
    res.status(out.status);
    return out.body;
  }

  @Post('support/tickets')
  @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(TicketInput)) body: z.infer<typeof TicketInput>) {
    return this.support.createTicket(userIdOf(actor), actor.siteId!, body);
  }

  @Get('support/tickets')
  mine(@CurrentActor() actor: Actor) {
    return this.support.mine(userIdOf(actor));
  }

  @Get('support/tickets/:ticketId')
  get(@CurrentActor() actor: Actor, @Param('ticketId', new ZodPipe(Uuid)) id: string) {
    return this.support.ticket(userIdOf(actor), id);
  }

  @Post('support/tickets/:ticketId/messages')
  @HttpCode(204)
  async reply(@CurrentActor() actor: Actor, @Param('ticketId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(MessageInput)) body: z.infer<typeof MessageInput>) {
    await this.support.reply(userIdOf(actor), id, body.body);
  }

  // ---------------------------------------------------------------- staff

  @Auth('staff')
  @Get('admin/support/tickets')
  staffList(@CurrentActor() actor: Actor, @Query(new ZodPipe(StaffQuery)) q: z.infer<typeof StaffQuery>) {
    requireRole(actor, STAFF);
    return this.support.staffList(q.status);
  }

  @Auth('staff')
  @Get('admin/support/tickets/:ticketId')
  staffGet(@CurrentActor() actor: Actor, @Param('ticketId', new ZodPipe(Uuid)) id: string) {
    requireRole(actor, STAFF);
    return this.support.ticket(null, id);
  }

  @Auth('staff')
  @Post('admin/support/tickets/:ticketId/messages')
  @HttpCode(200)
  staffReply(@CurrentActor() actor: Actor, @Param('ticketId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(StaffReply)) body: z.infer<typeof StaffReply>) {
    requireRole(actor, STAFF);
    return this.support.staffReply(userIdOf(actor), id, body.body, body.resolve);
  }
}

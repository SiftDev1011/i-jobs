import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, requireRole, userIdOf } from '../auth/actor';
import { Uuid, ZodPipe } from '../common/zod';
import { ModerationService } from './moderation.service';

const ListQuery = z.object({
  subject: z.enum(['job', 'community', 'owner', 'employer', 'user']).optional(),
  status: z.enum(['open', 'in_review', 'escalated', 'approved', 'rejected']).optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const Decision = z.object({
  decision: z.enum(['approve', 'reject', 'reject_as_scam', 'escalate']),
  note: z.string().trim().max(2000).optional(),
  strike: z.boolean().optional(),
}).strict();

@Auth('staff')
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    requireRole(actor, ['admin', 'moderator']);
    return this.moderation.list(q);
  }

  @Post(':itemId/decision')
  @HttpCode(200)
  decide(@CurrentActor() actor: Actor, @Param('itemId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(Decision)) body: z.infer<typeof Decision>) {
    requireRole(actor, ['admin', 'moderator']);
    return this.moderation.decide(id, userIdOf(actor), body);
  }
}

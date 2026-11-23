import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, CurrentActor, userIdOf } from '../auth/actor';
import { ZodPipe } from '../common/zod';
import { NotificationsService, Viewer } from './notifications.service';

const ListQuery = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const ReadInput = z.object({ ids: z.array(z.uuid()).max(500).optional() }).strict();

const viewer = (actor: Actor): Viewer => ({ userId: userIdOf(actor), siteId: actor.siteId!, partner: actor.kind === 'site' });

@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.notifications.list(viewer(actor), q);
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentActor() actor: Actor, @Body(new ZodPipe(ReadInput)) body: z.infer<typeof ReadInput>) {
    await this.notifications.markRead(viewer(actor), body.ids);
  }
}

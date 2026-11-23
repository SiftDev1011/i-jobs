import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, requireRole, userIdOf } from '../auth/actor';
import { Problem } from '../common/problem';
import { Uuid, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';

const ListQuery = z.object({ status: z.enum(['received', 'in_progress', 'done', 'refused']).optional() });
const Close = z.object({ status: z.enum(['done', 'refused']), note: z.string().trim().max(2000).optional() }).strict();

/** The data protection officer's view: open requests, and closing the ones a person handles. */
@Auth('staff')
@Controller('admin/data-requests')
export class AdminDataRequestsController {
  constructor(private readonly db: Db) {}

  @Get()
  async list(@CurrentActor() actor: Actor, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    requireRole(actor, ['admin', 'dpo']);
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('data_requests').select(['id', 'user_id', 'type', 'status', 'details', 'due_at', 'process_after', 'completed_at', 'created_at'])
        .where('status', 'in', q.status ? [q.status] : ['received', 'in_progress']).orderBy('due_at').limit(500).execute(),
    );
    return rows;
  }

  /** Close a request by hand. Refusing a delete that hasn't run yet stops it. */
  @Post(':requestId')
  @HttpCode(200)
  async close(@CurrentActor() actor: Actor, @Param('requestId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(Close)) body: z.infer<typeof Close>) {
    requireRole(actor, ['admin', 'dpo']);
    return this.db.asEngine(async (trx) => {
      const r = await trx.updateTable('data_requests').set({ status: body.status, completed_at: sql`now()` })
        .where('id', '=', id).where('status', 'in', ['received', 'in_progress']).returning(['id', 'type', 'status', 'user_id']).executeTakeFirst();
      if (!r) throw Problem.conflict('request_closed', 'This request is already finished or does not exist');
      await trx.insertInto('audit_log').values({ actor_user_id: userIdOf(actor), actor_kind: 'staff', action: `data_request.${body.status}`, subject_type: 'user', subject_id: r.user_id, meta: JSON.stringify({ request: id, type: r.type, note: body.note ?? null }) }).execute();
      return { id: r.id, type: r.type, status: r.status };
    });
  }
}

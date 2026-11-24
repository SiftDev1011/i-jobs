import { Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Actor, Auth, CurrentActor, userIdOf } from '../auth/actor';
import { Problem } from '../common/problem';
import { Uuid, ZodPipe } from '../common/zod';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { PagaClient } from '../money/paga';
import { MembershipService } from './membership.service';

/**
 * Demo payments, for development and demos only. With PAGA_DRIVER=fake (never allowed in production)
 * a "checkout" is the web app's /demo-pay page; its button lands here, and we play Paga's part: a
 * correctly signed success callback through the same code a real payment takes.
 */
@Controller('dev/demo-payments')
export class DemoPaymentsController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: Db,
    private readonly paga: PagaClient,
    private readonly memberships: MembershipService,
  ) {}

  @Auth('user')
  @Post(':paymentId/complete')
  @HttpCode(200)
  async complete(@CurrentActor() a: Actor, @Param('paymentId', new ZodPipe(Uuid)) id: string) {
    if (this.config.PAGA_DRIVER !== 'fake') throw Problem.notFound('not_found', 'Demo payments are off');
    const userId = userIdOf(a);
    const p = await this.db.asEngine((trx) =>
      trx.selectFrom('payments').select(['id', 'status', 'provider_ref', 'amount_kobo']).where('id', '=', id).where('user_id', '=', userId).executeTakeFirst(),
    );
    if (!p) throw Problem.notFound('payment_not_found', 'There is no payment of yours here');
    if (p.status === 'pending' && p.provider_ref) {
      await this.memberships.onPagaCallback(this.paga.signCallback({
        notificationId: `demo-${p.id}`, statusCode: '0', externalReferenceNumber: p.provider_ref, state: 'COMPLETE', event: 'PAYMENT_COMPLETE',
        outstandingBalance: null, paymentAmount: Number(p.amount_kobo) / 100, collectionFee: 0,
      }));
    }
    return this.memberships.payment(userId, id);
  }
}

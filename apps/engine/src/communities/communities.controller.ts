import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, Public, requireRole, userIdOf } from '../auth/actor';
import { Idempotent } from '../common/idempotency';
import { Problem } from '../common/problem';
import { Uuid, ZodPipe } from '../common/zod';
import { PagaCallback, PagaClient } from '../money/paga';
import { PayoutsService } from '../money/payouts.service';
import { AdminCommunitiesService } from './admin-communities.service';
import { MembershipService } from './membership.service';
import { OwnerService } from './owner.service';

const Money = z.object({ amount_minor: z.number().int().positive(), currency: z.string().regex(/^[A-Za-z]{3}$/) });
const Period = z.enum(['monthly', 'quarterly', 'yearly']);
const limit = z.coerce.number().int().min(1).max(100).default(20);

const OwnerApplication = z.object({
  legal_name: z.string().trim().min(3).max(120),
  id_type: z.enum(['nin', 'passport', 'drivers_licence', 'voters_card']),
  id_number: z.string().trim().min(5).max(40),
  id_document_upload_id: z.string().max(200).optional(),
  bank_code: z.string().trim().max(20).optional(),
  bank_account_number: z.string().regex(/^\d{10}$/, 'Use the 10-digit account number').optional(),
  community_name: z.string().trim().min(3).max(80),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/, 'Use 3-40 lowercase letters, numbers and dashes'),
  description: z.string().trim().max(1000).optional(),
  proof_links: z.array(z.url({ protocol: /^https$/ })).min(1).max(10),
  claimed_member_count: z.number().int().min(0).max(1_000_000).optional(),
  group_started_on: z.iso.date().optional(),
  evidence_upload_ids: z.array(z.string().max(200)).max(10).optional(),
  price: Money,
  billing_period: Period,
  trial_enabled: z.boolean().default(false),
  approval_required: z.boolean().default(false),
});

const CommunityUpdate = z.object({ description: z.string().trim().max(1000), trial_enabled: z.boolean(), approval_required: z.boolean(), price: Money, billing_period: Period }).partial().strict();
const Corrections = z.object({
  title: z.string().trim().min(3).max(200), company_name: z.string().trim().min(1).max(120), description: z.string().trim().min(40).max(20000),
  apply_url: z.url({ protocol: /^https?$/ }).nullable(), apply_email: z.email().nullable(),
}).partial().strict();

@Controller()
export class CommunitiesController {
  constructor(
    private readonly owners: OwnerService,
    private readonly memberships: MembershipService,
    private readonly admin: AdminCommunitiesService,
    private readonly payouts: PayoutsService,
    private readonly paga: PagaClient,
  ) {}

  // ---------------------------------------------------------------- joining (members)

  @Public()
  @Get('join/:code')
  joinPage(@Param('code', new ZodPipe(z.string().min(3).max(60))) code: string) {
    return this.memberships.joinPage(code);
  }

  @Auth('user')
  @Post('join')
  join(@CurrentActor() a: Actor, @Body(new ZodPipe(z.object({ code: z.string().trim().min(3).max(60), via: z.enum(['invite_link', 'invite_code', 'bulk_invite', 'job_finds_page']).optional() }))) b: { code: string; via?: 'invite_link' | 'invite_code' | 'bulk_invite' | 'job_finds_page' }) {
    return this.memberships.join(userIdOf(a), b.code, b.via);
  }

  @Public()
  @Get('communities')
  search(@Query(new ZodPipe(z.object({ q: z.string().max(80).optional(), cursor: z.string().optional(), limit }))) q: { q?: string; limit: number }) {
    return this.memberships.search(q.q, q.limit);
  }

  @Auth('user')
  @Post('communities/:communityId/join-requests')
  requestToJoin(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.memberships.requestToJoin(userIdOf(a), id);
  }

  @Auth('user')
  @Get('me/memberships')
  mine(@CurrentActor() a: Actor) {
    return this.memberships.mine(userIdOf(a));
  }

  @Auth('user')
  @Post('memberships/:membershipId/trial')
  @HttpCode(200)
  trial(@CurrentActor() a: Actor, @Param('membershipId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ phone_verification_code: z.string().regex(/^\d{6}$/), card_token: z.string().max(200).optional() }))) b: { phone_verification_code: string; card_token?: string }) {
    return this.memberships.startTrial(userIdOf(a), id, b.phone_verification_code, b.card_token);
  }

  @Auth('user')
  @Idempotent()
  @Post('memberships/:membershipId/checkout')
  checkout(@CurrentActor() a: Actor, @Param('membershipId', new ZodPipe(Uuid)) id: string) {
    return this.memberships.checkout(userIdOf(a), id);
  }

  @Public()
  @Post('hooks/paga')
  @HttpCode(200)
  async pagaHook(@Body() body: PagaCallback) {
    if (!this.paga.verifyCallback(body)) throw Problem.unauthorized('bad_signature', 'The Paga signature does not match');
    return { status: await this.memberships.onPagaCallback(body) };
  }

  // ---------------------------------------------------------------- owners

  @Auth('user')
  @Get('owner/pricing-rules')
  pricing() {
    return this.owners.pricingRules();
  }

  @Auth('user')
  @Post('owner/applications')
  apply(@CurrentActor() a: Actor, @Body(new ZodPipe(OwnerApplication)) b: z.infer<typeof OwnerApplication>) {
    return this.owners.apply(userIdOf(a), b);
  }

  @Auth('user')
  @Get('owner/communities')
  ownerList(@CurrentActor() a: Actor) {
    return this.owners.list(userIdOf(a));
  }

  @Auth('user')
  @Get('owner/communities/:communityId')
  ownerGet(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.get(userIdOf(a), id);
  }

  @Auth('user')
  @Patch('owner/communities/:communityId')
  ownerUpdate(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(CommunityUpdate)) b: z.infer<typeof CommunityUpdate>) {
    return this.owners.update(userIdOf(a), id, b);
  }

  @Auth('user')
  @Get('owner/communities/:communityId/funnel')
  funnel(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.funnel(userIdOf(a), id);
  }

  @Auth('user')
  @Get('owner/communities/:communityId/members')
  members(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Query(new ZodPipe(z.object({ stage: z.enum(['awaiting_approval', 'not_paid_yet', 'on_trial', 'stuck_no_cv', 'stuck_no_rules', 'fully_set_up']).optional() }))) q: { stage?: string }) {
    return this.owners.members(userIdOf(a), id, q.stage);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/members/:membershipId/approve')
  @HttpCode(200)
  approve(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Param('membershipId', new ZodPipe(Uuid)) m: string) {
    return this.owners.approve(userIdOf(a), id, m);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/members/:membershipId/decline')
  @HttpCode(204)
  async decline(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Param('membershipId', new ZodPipe(Uuid)) m: string) {
    await this.owners.decline(userIdOf(a), id, m);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/members/:membershipId/nudge')
  @HttpCode(202)
  async nudge(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Param('membershipId', new ZodPipe(Uuid)) m: string) {
    await this.owners.nudge(userIdOf(a), id, m);
    return { status: 'sent' };
  }

  @Auth('user')
  @Get('owner/communities/:communityId/invites')
  invites(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.invites(userIdOf(a), id);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/invites')
  @HttpCode(202)
  sendInvites(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ targets: z.array(z.string().max(254)).min(1).max(500) }))) b: { targets: string[] }) {
    return this.owners.sendInvites(userIdOf(a), id, b.targets);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/demo-tours')
  demo(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.demoTour(userIdOf(a), id);
  }

  @Auth('user')
  @Get('owner/communities/:communityId/jobs')
  jobs(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.communityJobs(userIdOf(a), id);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/jobs')
  @HttpCode(202)
  paste(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ text: z.string().trim().min(40).max(20000).optional(), image_upload_id: z.string().optional() }))) b: { text?: string; image_upload_id?: string }) {
    if (!b.text) throw Problem.unprocessable('image_not_supported_yet', 'Paste the job as text for now; flyer images are coming');
    return this.owners.pasteJob(userIdOf(a), id, b.text);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/jobs/:jobId/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Param('jobId', new ZodPipe(Uuid)) job: string, @Body(new ZodPipe(Corrections)) b: z.infer<typeof Corrections>) {
    return this.owners.confirmJob(userIdOf(a), id, job, b);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/jobs/:jobId/renew')
  @HttpCode(200)
  renew(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Param('jobId', new ZodPipe(Uuid)) job: string) {
    return this.owners.renewJob(userIdOf(a), id, job);
  }

  @Auth('user')
  @Get('owner/communities/:communityId/earnings')
  earnings(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.earnings(userIdOf(a), id);
  }

  @Auth('user')
  @Get('owner/communities/:communityId/strikes')
  strikes(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.strikes(userIdOf(a), id);
  }

  @Public()
  @Get('demo/:token')
  demoTourView(@Param('token', new ZodPipe(z.string().max(80))) token: string) {
    return this.owners.demo(token);
  }

  @Auth('user')
  @Get('payments/:paymentId')
  payment(@CurrentActor() a: Actor, @Param('paymentId', new ZodPipe(Uuid)) id: string) {
    return this.memberships.payment(userIdOf(a), id);
  }

  @Auth('user')
  @Post('owner/communities/:communityId/strikes/:strikeId/appeal')
  @HttpCode(202)
  async appeal(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Param('strikeId', new ZodPipe(Uuid)) s: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(10).max(2000) }))) b: { reason: string }) {
    await this.owners.appealStrike(userIdOf(a), id, s, b.reason);
    return { status: 'received' };
  }

  @Auth('user')
  @Get('owner/communities/:communityId/code-batches')
  batches(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string) {
    return this.owners.batches(userIdOf(a), id);
  }

  @Auth('user')
  @Idempotent()
  @Post('owner/communities/:communityId/code-batches')
  buyCodes(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ quantity: z.number().int().min(1).max(10000), accept_terms: z.literal(true, { message: 'Accept that codes never expire and are non-refundable' }) }))) b: { quantity: number }) {
    return this.owners.buyCodes(userIdOf(a), id, b.quantity);
  }

  @Auth('user')
  @Get('owner/code-batches/:batchId/codes')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="access-codes.csv"')
  codes(@CurrentActor() a: Actor, @Param('batchId', new ZodPipe(Uuid)) id: string) {
    return this.owners.codesCsv(userIdOf(a), id);
  }

  // ---------------------------------------------------------------- our team

  @Auth('staff')
  @Post('admin/communities/:communityId/verify')
  @HttpCode(200)
  verify(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ decision: z.enum(['approved', 'rejected', 'needs_more_info']), note: z.string().max(2000).optional() }))) b: { decision: 'approved' | 'rejected' | 'needs_more_info'; note?: string }) {
    requireRole(a, ['admin', 'moderator']);
    return this.admin.verify(id, userIdOf(a), b.decision, b.note);
  }

  @Auth('staff')
  @Post('admin/communities/:communityId/ban')
  @HttpCode(200)
  ban(@CurrentActor() a: Actor, @Param('communityId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(5).max(2000) }))) b: { reason: string }) {
    requireRole(a, ['admin']);
    return this.admin.ban(id, userIdOf(a), b.reason);
  }

  @Auth('staff')
  @Get('admin/payouts')
  payoutList(@CurrentActor() a: Actor, @Query(new ZodPipe(z.object({ status: z.enum(['held', 'ready', 'processing', 'paid', 'frozen', 'failed']).optional() }))) q: { status?: string }) {
    requireRole(a, ['admin', 'finance']);
    return this.payouts.list(q.status);
  }

  @Auth('staff')
  @Post('admin/payouts/:payoutId/release')
  @HttpCode(202)
  release(@CurrentActor() a: Actor, @Param('payoutId', new ZodPipe(Uuid)) id: string) {
    requireRole(a, ['admin', 'finance']);
    return this.payouts.release(id, userIdOf(a));
  }

  @Auth('staff')
  @Post('admin/payouts/:payoutId/paid')
  @HttpCode(200)
  paid(@CurrentActor() a: Actor, @Param('payoutId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(z.object({ reference: z.string().trim().min(4).max(100) }))) b: { reference: string }) {
    requireRole(a, ['admin', 'finance']);
    return this.payouts.markPaid(id, userIdOf(a), b.reference);
  }
}

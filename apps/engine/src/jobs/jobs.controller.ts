import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, Public, userIdOf } from '../auth/actor';
import { Uuid, ZodPipe } from '../common/zod';
import { JobsService } from './jobs.service';

/** "a,b,c" or repeated params → array. */
const list = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean)), z.array(item).max(10).optional());
const boolParam = z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean());
const limit = z.coerce.number().int().min(1).max(100).default(20);

const SearchQuery = z.object({
  q: z.string().max(200).optional(),
  location: list(z.enum(['worldwide', 'unspecified', 'restricted'])),
  employment_type: list(z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'graduate', 'temporary'])),
  min_pay_monthly: z.coerce.number().int().positive().optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code').default('USD'),
  verified_only: boolParam.default(false),
  category: z
    .enum(['engineering', 'data', 'design', 'product', 'marketing', 'sales', 'customer-support', 'writing', 'operations', 'finance', 'hr', 'education', 'health', 'legal', 'ngo', 'internships', 'other'])
    .optional(),
  cursor: z.string().max(500).optional(),
  limit,
});

const FindsQuery = z.object({ ref: z.string().max(64).optional(), cursor: z.string().max(500).optional(), limit });

const ReportInput = z.object({
  reason: z.enum(['scam', 'asks_for_money', 'wrong_details', 'closed', 'offensive', 'other']),
  details: z.string().max(1000).optional(),
});

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Public()
  @Get('jobs')
  search(@Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>) {
    return this.jobs.search(q);
  }

  @Public()
  @Get('jobs/:jobId')
  get(@Param('jobId', new ZodPipe(Uuid)) id: string) {
    return this.jobs.get(id);
  }

  @Auth('required')
  @Post('jobs/:jobId/reports')
  @HttpCode(202)
  async report(@CurrentActor() actor: Actor, @Param('jobId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(ReportInput)) body: z.infer<typeof ReportInput>) {
    await this.jobs.report(id, userIdOf(actor), body.reason, body.details);
    return { status: 'received' };
  }

  @Public()
  @Get('job-finds')
  finds(@Query(new ZodPipe(FindsQuery)) q: z.infer<typeof FindsQuery>) {
    return this.jobs.jobFinds(q.ref, q.cursor, q.limit);
  }
}

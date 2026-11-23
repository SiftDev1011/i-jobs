import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, userIdOf } from '../auth/actor';
import { Uuid, ZodPipe } from '../common/zod';
import { EmployersService } from './employers.service';

const iso2 = z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code');

const Start = z.object({
  company_name: z.string().trim().min(2).max(160),
  work_email: z.email().max(254),
  website_url: z.url().max(300),
  registry_number: z.string().trim().max(40).optional(),
  country: iso2.optional(),
}).strict();
const Confirm = z.object({ work_email: z.email().max(254), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict();

const JobInput = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(100, 'Describe the job in at least 100 characters').max(20_000),
  company_name: z.string().trim().max(120).optional(),
  location_scope: z.enum(['worldwide', 'unspecified', 'restricted']),
  allowed_countries: z.array(iso2).max(60).optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'graduate', 'temporary']).optional(),
  pay: z.object({
    min_minor: z.number().int().min(0).nullable().optional(),
    max_minor: z.number().int().min(0).nullable().optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/).nullable().optional(),
    period: z.enum(['hour', 'day', 'week', 'month', 'year', 'project']).nullable().optional(),
  }).refine((p) => p.min_minor == null || p.max_minor == null || p.min_minor <= p.max_minor, 'The lowest pay must not be above the highest').optional(),
  apply_email: z.email().max(254).optional(),
  apply_url: z.url({ protocol: /^https$/ }).max(500).optional(),
  deadline_at: z.iso.datetime({ offset: true }).optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(15).optional(),
  accept_on_platform: z.boolean().optional(),
  max_applicants: z.number().int().min(1).max(10_000).nullable().optional(),
}).strict();

const Connect = z.object({
  provider: z.enum(['greenhouse', 'lever', 'ashby']),
  board_token: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/, 'Use the board token exactly as your ATS shows it'),
  api_key: z.string().trim().min(8).max(500),
}).strict();

@Auth('user')
@Controller('employers')
export class EmployersController {
  constructor(private readonly employers: EmployersService) {}

  @Get('mine')
  mine(@CurrentActor() actor: Actor) {
    return this.employers.mine(userIdOf(actor));
  }

  @Get(':employerId')
  detail(@CurrentActor() actor: Actor, @Param('employerId', new ZodPipe(Uuid)) id: string) {
    return this.employers.detail(userIdOf(actor), id);
  }

  @Post('verifications')
  @HttpCode(202)
  start(@CurrentActor() actor: Actor, @Body(new ZodPipe(Start)) body: z.infer<typeof Start>) {
    return this.employers.startVerification(userIdOf(actor), body);
  }

  @Post('verifications/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() actor: Actor, @Body(new ZodPipe(Confirm)) body: z.infer<typeof Confirm>) {
    return this.employers.confirmVerification(userIdOf(actor), body.work_email, body.code);
  }

  @Post(':employerId/jobs')
  @HttpCode(201)
  post(@CurrentActor() actor: Actor, @Param('employerId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(JobInput)) body: z.infer<typeof JobInput>) {
    return this.employers.postJob(userIdOf(actor), id, body);
  }

  @Post(':employerId/integrations')
  @HttpCode(201)
  connect(@CurrentActor() actor: Actor, @Param('employerId', new ZodPipe(Uuid)) id: string, @Body(new ZodPipe(Connect)) body: z.infer<typeof Connect>) {
    return this.employers.connect(userIdOf(actor), id, body);
  }

  @Delete(':employerId/integrations/:integrationId')
  @HttpCode(204)
  async disconnect(@CurrentActor() actor: Actor, @Param('employerId', new ZodPipe(Uuid)) id: string, @Param('integrationId', new ZodPipe(Uuid)) integrationId: string) {
    await this.employers.disconnect(userIdOf(actor), id, integrationId);
  }
}

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Auth, CurrentActor, userIdOf } from '../auth/actor';
import { Problem } from '../common/problem';
import { Uuid, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';
import { isTimezone } from './strength';
import { CV_TYPES } from './cv-text';
import { isRuleRegion, MatchesService } from './matches.service';
import { ProfileService } from './profile.service';

const iso2 = z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code');
const day = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use YYYY-MM-DD').transform((s) => (s.length === 7 ? `${s}-01` : s));

const ProfileInput = z
  .object({
    headline: z.string().trim().max(120),
    summary: z.string().trim().max(1500),
    years_experience: z.number().min(0).max(60),
    country: iso2,
    city: z.string().trim().max(80),
    timezone: z.string().refine(isTimezone, 'Use a time zone like Africa/Lagos'),
    work_authorization: z.object({ remote_any_country: z.boolean().optional(), countries: z.array(iso2).max(30).optional() }),
    skills: z.array(z.string().trim().min(1).max(50)).max(40),
    experience: z.array(z.object({
      title: z.string().trim().min(1).max(120),
      company: z.string().trim().max(120).optional(),
      start: day.nullable().optional(),
      end: day.nullable().optional(),
      highlights: z.array(z.string().trim().max(300)).max(6).optional(),
    })).max(15),
    education: z.array(z.object({ school: z.string().trim().min(1).max(160), qualification: z.string().trim().max(160).optional(), year: z.number().int().min(1950).max(2100).nullable().optional() })).max(10),
    languages: z.array(z.string().trim().min(1).max(40)).max(10),
    links: z.array(z.url({ protocol: /^https?$/ })).max(10),
  })
  .partial()
  .strict();

const UploadInput = z.object({
  file_name: z.string().trim().min(1).max(200),
  content_type: z.enum([CV_TYPES.pdf, CV_TYPES.docx], { message: 'Upload a PDF or a Word (.docx) file' }),
  size_bytes: z.number().int().positive().max(5 * 1024 * 1024, 'The CV must be 5 MB or smaller'),
});

const AutopilotInput = z
  .object({
    enabled: z.boolean(),
    min_match: z.number().int().min(0).max(100),
    min_pay_monthly: z.object({ amount_minor: z.number().int().min(0), currency: z.string().regex(/^[A-Za-z]{3}$/) }).nullable(),
    regions: z.array(z.string().refine(isRuleRegion, 'Use worldwide, a region (africa, emea, europe...) or a 2-letter country code')).max(20),
    include_unspecified: z.boolean(),
    employment_types: z.array(z.enum(['full_time', 'part_time', 'contract', 'freelance', 'internship', 'graduate', 'temporary'])).max(7),
    daily_cap: z.number().int().min(1).max(20),
    paused_until: z.iso.datetime({ offset: true }).nullable(),
  })
  .partial()
  .strict();

const list = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(','))), z.array(item).max(5).optional());
const MatchQuery = z.object({
  status: list(z.enum(['new', 'seen', 'saved', 'dismissed'])),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const TrainingInput = z
  .array(z.object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    url: z.url({ protocol: /^https$/ }),
    skills: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
    duration_minutes: z.number().int().positive().nullable().optional(),
    is_free: z.boolean().default(true),
    suitable_for_minors: z.boolean().default(false),
  }))
  .max(5000);

@Controller()
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly matches: MatchesService,
    private readonly db: Db,
  ) {}

  @Post('me/cv')
  startUpload(@CurrentActor() actor: Actor, @Body(new ZodPipe(UploadInput)) body: z.infer<typeof UploadInput>) {
    return this.profiles.startUpload(userIdOf(actor), body);
  }

  @Post('me/cv/parse')
  @HttpCode(202)
  parse(@CurrentActor() actor: Actor, @Body(new ZodPipe(z.object({ upload_id: z.string().min(4).max(80) }))) body: { upload_id: string }) {
    return this.profiles.requestParse(userIdOf(actor), actor.siteId!, body.upload_id);
  }

  @Get('me/profile')
  get(@CurrentActor() actor: Actor) {
    return this.profiles.get(userIdOf(actor));
  }

  @Patch('me/profile')
  update(@CurrentActor() actor: Actor, @Body(new ZodPipe(ProfileInput)) body: z.infer<typeof ProfileInput>) {
    return this.profiles.update(userIdOf(actor), body);
  }

  @Post('me/profile/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() actor: Actor) {
    return this.profiles.confirm(userIdOf(actor));
  }

  @Get('me/autopilot')
  rules(@CurrentActor() actor: Actor) {
    return this.matches.getRules(userIdOf(actor));
  }

  @Put('me/autopilot')
  setRules(@CurrentActor() actor: Actor, @Body(new ZodPipe(AutopilotInput)) body: z.infer<typeof AutopilotInput>) {
    return this.matches.setRules(userIdOf(actor), actor.siteId!, body);
  }

  @Get('me/matches')
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(MatchQuery)) q: z.infer<typeof MatchQuery>) {
    return this.matches.list(userIdOf(actor), actor.siteId!, q);
  }

  @Patch('me/matches/:jobId')
  mark(@CurrentActor() actor: Actor, @Param('jobId', new ZodPipe(Uuid)) jobId: string, @Body(new ZodPipe(z.object({ status: z.enum(['seen', 'saved', 'dismissed']) }))) body: { status: 'seen' | 'saved' | 'dismissed' }) {
    return this.matches.setStatus(userIdOf(actor), actor.siteId!, jobId, body.status);
  }

  /** A partner site's course catalogue. Replaces what that site sent before. */
  @Auth('site')
  @Put('partner/trainings')
  @HttpCode(202)
  async trainings(@CurrentActor() actor: Actor, @Body(new ZodPipe(TrainingInput)) body: z.infer<typeof TrainingInput>) {
    const ids = body.map((t) => t.id);
    if (new Set(ids).size !== ids.length) throw Problem.badRequest('duplicate_ids', 'Each course needs its own id');
    const siteId = actor.siteId!;
    await this.db.asEngine(async (trx) => {
      for (const t of body) {
        const values = {
          title: t.title, url: t.url, skills: t.skills.map((s) => s.toLowerCase()), duration_minutes: t.duration_minutes ?? null,
          is_free: t.is_free, suitable_for_minors: t.suitable_for_minors, active: true,
        };
        await trx.insertInto('trainings').values({ site_id: siteId, external_id: t.id, ...values }).onConflict((oc) => oc.columns(['site_id', 'external_id']).doUpdateSet(values)).execute();
      }
      await trx.updateTable('trainings').set({ active: false }).where('site_id', '=', siteId).$if(ids.length > 0, (q) => q.where('external_id', 'not in', ids)).execute();
    });
    return { accepted: body.length };
  }
}

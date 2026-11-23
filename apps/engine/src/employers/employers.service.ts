import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { hmacHex, randomToken, safeEqual, sixDigitCode } from '../common/crypto';
import { Problem } from '../common/problem';
import { assertPublicHttpsUrl, Resolver, resolvesPublic } from '../common/safe-url';
import { SecretBox } from '../common/secretbox';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import type { EmploymentType, PayPeriod } from '../db/schema';
import { categorise, dedupeKey, seniority } from '../ingest/normalise';
import { PERSONAL_MAIL, SCAM_REVIEW, screen } from '../ingest/scam';
import { firstWords, oneLine, truncate } from '../ingest/text';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../messaging/mail.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { RedisService } from '../redis/redis.service';
import { AtsKeyChecker, AtsProvider } from './ats-check';

const CODE_MINUTES = 15;
const MAX_TRIES = 5;
const JOB_DAYS = 30;

export interface VerificationInput { company_name: string; work_email: string; website_url: string; registry_number?: string; country?: string }
export interface EmployerJobInput {
  title: string;
  description: string;
  company_name?: string;
  location_scope: 'worldwide' | 'unspecified' | 'restricted';
  allowed_countries?: string[];
  employment_type?: EmploymentType;
  pay?: { min_minor?: number | null; max_minor?: number | null; currency?: string | null; period?: PayPeriod | null };
  apply_email?: string;
  apply_url?: string;
  deadline_at?: string;
  skills?: string[];
  accept_on_platform?: boolean;
  max_applicants?: number | null;
}

/** Hosts match when one is the other or a sub-domain of it (careers.acme.com and acme.com). */
export function sameOrganisation(emailDomain: string, websiteHost: string): boolean {
  const a = emailDomain.toLowerCase().replace(/^www\./, '');
  const b = websiteHost.toLowerCase().replace(/^www\./, '');
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Employers: proving who they are, posting jobs and connecting their ATS. */
@Injectable()
export class EmployersService {
  private readonly logger = new Logger('Employers');
  private readonly box: SecretBox;
  /** Swapped in tests. */
  fetchFn: typeof fetch = fetch;
  resolve?: Resolver;

  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly queues: QueueService,
    private readonly jobs: JobsService,
    private readonly ats: AtsKeyChecker,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY);
  }

  // ---------------------------------------------------------------- verification

  async startVerification(userId: string, input: VerificationInput) {
    const email = input.work_email.trim().toLowerCase();
    const emailDomain = email.split('@')[1] ?? '';
    const site = assertPublicHttpsUrl(input.website_url, 'website_url');
    if (PERSONAL_MAIL.has(emailDomain)) throw Problem.unprocessable('free_email_provider', 'Use an email address on your company’s own domain, not a free email provider');
    if (!sameOrganisation(emailDomain, site.hostname)) throw Problem.unprocessable('domain_mismatch', `The email address must be on the website’s domain (${site.hostname.replace(/^www\./, '')})`);

    const tries = await this.redis.hit(`employer-verify:${userId}`, 5, 3600);
    if (!tries.allowed) throw Problem.tooMany(tries.retryAfterSeconds, 'Too many codes requested. Try again later.');

    const domain = emailDomain;
    const employer = await this.db.asEngine(async (trx) => {
      const found = await trx.selectFrom('employers').select(['id', 'verification']).where('domain', '=', domain).executeTakeFirst();
      if (found) {
        if (found.verification === 'revoked') throw Problem.forbidden('employer_revoked', 'This company can no longer post on i-jobs. Contact support.');
        return found;
      }
      return trx.insertInto('employers').values({
        name: oneLine(input.company_name, 160), domain, website_url: site.toString(), registry_number: input.registry_number?.trim() || null,
        country: input.country?.toUpperCase() ?? null, verification: 'pending',
      }).returning(['id', 'verification']).executeTakeFirstOrThrow();
    });

    const code = sixDigitCode();
    await this.redis.client.set(`employer-code:${userId}`, JSON.stringify({ email, employerId: employer.id, hash: hmacHex(this.config.AUTH_PEPPER, `${email}:${code}`), tries: 0 }), 'EX', CODE_MINUTES * 60);
    await this.mail.send({ to: email, subject: `${code} is your i-jobs employer code`, text: `Your code to confirm ${email} for i-jobs is ${code}. It expires in ${CODE_MINUTES} minutes.\n\nIf you didn't ask for this, ignore this email.` });
    return { employer_id: employer.id, sent_to: email };
  }

  async confirmVerification(userId: string, workEmail: string, code: string) {
    const key = `employer-code:${userId}`;
    const raw = await this.redis.client.get(key);
    const email = workEmail.trim().toLowerCase();
    if (!raw) throw Problem.unauthorized('code_expired', 'This code has expired. Request a new one.');
    const saved = JSON.parse(raw) as { email: string; employerId: string; hash: string; tries: number };
    if (saved.tries >= MAX_TRIES) throw Problem.unauthorized('code_locked', 'Too many wrong tries. Request a new code.');
    if (saved.email !== email || !safeEqual(saved.hash, hmacHex(this.config.AUTH_PEPPER, `${email}:${code.trim()}`))) {
      await this.redis.client.set(key, JSON.stringify({ ...saved, tries: saved.tries + 1 }), 'KEEPTTL');
      throw Problem.unauthorized('code_invalid', 'That code is not right. Check it and try again.');
    }
    await this.redis.client.del(key);

    await this.db.asEngine(async (trx) => {
      const members = await trx.selectFrom('employer_members').select(sql<number>`count(*)::int`.as('n')).where('employer_id', '=', saved.employerId).executeTakeFirstOrThrow();
      await trx.insertInto('employer_members').values({ employer_id: saved.employerId, user_id: userId, role: members.n === 0 ? 'owner' : 'member', domain_email_verified_at: sql`now()` })
        .onConflict((oc) => oc.columns(['user_id', 'employer_id']).doUpdateSet({ domain_email_verified_at: sql`now()` })).execute();
      await trx.updateTable('employers').set({
        checks: sql`checks || '{"work_email": true}'::jsonb`,
        verification: sql`CASE WHEN verification = 'unverified' THEN 'pending'::verification_status ELSE verification END`,
        updated_at: sql`now()`,
      }).where('id', '=', saved.employerId).execute();
      // A person checks the company registry (CAC or the country's equivalent).
      const e = await trx.selectFrom('employers').select(['checks', 'name', 'registry_number', 'country']).where('id', '=', saved.employerId).executeTakeFirstOrThrow();
      const open = await trx.selectFrom('moderation_items').select('id').where('subject_type', '=', 'employer').where('subject_id', '=', saved.employerId).where('status', 'in', ['open', 'in_review', 'escalated']).executeTakeFirst();
      if (!(e.checks as { registry?: boolean }).registry && !open) {
        await trx.insertInto('moderation_items').values({ subject_type: 'employer', subject_id: saved.employerId, reason_internal: `Registry check: ${e.name}${e.registry_number ? `, number ${e.registry_number}` : ', no registry number given'}${e.country ? ` (${e.country})` : ''}` }).execute();
      }
    });
    await this.queues.add(QUEUES.maintenance, 'employer-website', { employerId: saved.employerId }, { jobId: `employer-website-${saved.employerId}-${Date.now()}`, attempts: 2 });
    return this.view(saved.employerId);
  }

  /** Worker: the website answers over https on the company's domain. */
  async checkWebsite(employerId: string): Promise<{ ok: boolean; reason?: string }> {
    const e = await this.db.asEngine((trx) => trx.selectFrom('employers').select(['domain', 'website_url']).where('id', '=', employerId).executeTakeFirst());
    if (!e?.website_url || !e.domain) return { ok: false, reason: 'no_website' };
    let url = e.website_url;
    let result: { ok: boolean; reason?: string } = { ok: false, reason: 'too_many_redirects' };
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(url);
      if (u.protocol !== 'https:') { result = { ok: false, reason: 'not_https' }; break; }
      if (!sameOrganisation(e.domain, u.hostname)) { result = { ok: false, reason: 'left_domain' }; break; }
      if (!(await resolvesPublic(u.hostname, this.resolve))) { result = { ok: false, reason: 'address_not_public' }; break; }
      try {
        const res = await this.fetchFn(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'i-jobs-verifier/1' } });
        await res.body?.cancel().catch(() => undefined);
        const next = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && next) { url = new URL(next, url).toString(); continue; }
        result = res.status < 400 ? { ok: true } : { ok: false, reason: `http_${res.status}` };
      } catch (err) {
        result = { ok: false, reason: (err as Error).name === 'TimeoutError' ? 'timeout' : 'network_error' };
      }
      break;
    }
    if (result.ok) await this.pass(employerId, 'website');
    else this.logger.warn(`website check failed for employer ${employerId}: ${result.reason}`);
    return result;
  }

  /** Record a passed check; all three make the employer verified. */
  async pass(employerId: string, check: 'website' | 'registry' | 'work_email') {
    await this.db.asEngine((trx) =>
      trx.updateTable('employers').set({
        checks: sql`checks || jsonb_build_object(${check}::text, true)`,
        updated_at: sql`now()`,
      }).where('id', '=', employerId).execute(),
    );
    await this.db.asEngine((trx) =>
      trx.updateTable('employers').set({ verification: 'verified', verified_at: sql`now()`, verified_via: 'domain_email + website + registry' })
        .where('id', '=', employerId).where('verification', '=', 'pending')
        .where(sql<boolean>`(checks->>'work_email')::boolean AND (checks->>'website')::boolean AND (checks->>'registry')::boolean`).execute(),
    );
  }

  async view(employerId: string) {
    const e = await this.db.asEngine((trx) => trx.selectFrom('employers').select(['id', 'name', 'domain', 'verification', 'checks']).where('id', '=', employerId).executeTakeFirst());
    if (!e) throw Problem.notFound('employer_not_found', 'There is no employer here');
    const c = e.checks as { work_email?: boolean; website?: boolean; registry?: boolean };
    return { id: e.id, name: e.name, domain: e.domain, verification: e.verification, checks: { work_email: !!c.work_email, website: !!c.website, registry: !!c.registry } };
  }

  /** Companies this person has confirmed a work email at. */
  async mine(userId: string) {
    const rows = await this.db.asEngine((trx) =>
      trx.selectFrom('employer_members').select(['employer_id', 'role']).where('user_id', '=', userId).where('domain_email_verified_at', 'is not', null).orderBy('created_at').execute(),
    );
    return Promise.all(rows.map(async (r) => ({ ...(await this.view(r.employer_id)), role: r.role })));
  }

  /** One company: its checks, connected ATS boards and the jobs it posted, with applicant counts. */
  async detail(userId: string, employerId: string) {
    const m = await this.member(userId, employerId);
    const [integrations, jobs] = await Promise.all([
      this.db.asEngine((trx) =>
        trx.selectFrom('employer_integrations').select(['id', 'provider', 'board_token', 'key_last4', 'connected_at']).where('employer_id', '=', employerId).where('revoked_at', 'is', null).orderBy('connected_at').execute()),
      this.db.asEngine((trx) =>
        trx.selectFrom('jobs as j')
          .select(['j.id', 'j.title', 'j.status', 'j.max_applicants', 'j.expires_at', 'j.first_seen_at', 'j.apply_email', 'j.apply_url',
            sql<number>`(SELECT count(*)::int FROM applications a WHERE a.job_id = j.id AND a.status NOT IN ('cancelled', 'failed', 'scheduled'))`.as('applicants')])
          .where('j.employer_id', '=', employerId).orderBy('j.first_seen_at', 'desc').limit(200).execute()),
    ]);
    const iso = (v: unknown) => new Date(v as string).toISOString();
    return {
      employer: await this.view(employerId),
      role: m.role,
      integrations: integrations.map((i) => ({ id: i.id, provider: i.provider, board_token: i.board_token, key_last4: i.key_last4, connected_at: iso(i.connected_at) })),
      jobs: jobs.map((j) => ({
        id: j.id, title: j.title,
        // Flagged posts say "in review" and never why.
        state: j.status === 'live' ? 'live' : j.status === 'pending_review' || j.status === 'scam' ? 'in_review' : j.status === 'expired' ? 'closed' : 'removed',
        applicants: Number(j.applicants), max_applicants: j.max_applicants, apply_to: j.apply_email ?? j.apply_url, posted_at: iso(j.first_seen_at), expires_at: iso(j.expires_at),
      })),
    };
  }

  /** Members who proved a work email on the domain can act for the employer. */
  private async member(userId: string, employerId: string) {
    const m = await this.db.asEngine((trx) =>
      trx.selectFrom('employer_members as m').innerJoin('employers as e', 'e.id', 'm.employer_id')
        .select(['m.role', 'e.verification', 'e.name', 'e.domain'])
        .where('m.employer_id', '=', employerId).where('m.user_id', '=', userId).where('m.domain_email_verified_at', 'is not', null).executeTakeFirst(),
    );
    if (!m) throw Problem.forbidden('not_employer_member', 'Confirm a work email at this company first');
    if (m.verification === 'revoked') throw Problem.forbidden('employer_revoked', 'This company can no longer post on i-jobs. Contact support.');
    return m;
  }

  // ---------------------------------------------------------------- jobs

  /** Live straight away for verified employers with nothing suspicious; otherwise a person reviews it. */
  async postJob(userId: string, employerId: string, input: EmployerJobInput) {
    const emp = await this.member(userId, employerId);
    const poster = await this.db.asEngine((trx) => trx.selectFrom('users').select('email').where('id', '=', userId).executeTakeFirstOrThrow());
    const onPlatform = input.accept_on_platform ?? true;
    if (!onPlatform && !input.apply_email && !input.apply_url) throw Problem.unprocessable('apply_route_required', 'Give an apply email or link, or accept applications on i-jobs');
    if (input.location_scope === 'restricted' && !input.allowed_countries?.length) throw Problem.unprocessable('countries_required', 'List the countries this job is open to');
    if (input.apply_url) assertPublicHttpsUrl(input.apply_url, 'apply_url');
    if (input.apply_email && !sameOrganisation(input.apply_email.split('@')[1] ?? '', emp.domain ?? '')) {
      throw Problem.unprocessable('apply_email_off_domain', `The apply email must be on ${emp.domain}`);
    }

    // Until the employer inbox ships, "on i-jobs" applications arrive by email (through the relay) at a verified work address.
    const applyEmail = onPlatform ? (input.apply_email ?? (poster.email && sameOrganisation(poster.email.split('@')[1] ?? '', emp.domain ?? '') ? poster.email : null)) : input.apply_email ?? null;
    if (onPlatform && !applyEmail) throw Problem.unprocessable('apply_email_required', `Give an apply email on ${emp.domain} to receive applications`);
    const applyMethod = applyEmail ? 'email' : 'external_link';

    const description = truncate(input.description.trim(), 20_000);
    const company = oneLine(input.company_name || emp.name, 120);
    const pay = input.pay ?? {};
    const risk = screen({ title: input.title, company, description, applyEmail, applyUrl: input.apply_url ?? null, payMaxMinor: pay.max_minor ?? null, payCurrency: pay.currency ?? null, payPeriod: pay.period ?? null });
    const verified = emp.verification === 'verified';
    const live = verified && risk.score < SCAM_REVIEW;
    const countries = (input.allowed_countries ?? []).map((c) => c.toUpperCase());
    const deadline = input.deadline_at ? new Date(input.deadline_at) : null;
    if (deadline && deadline.getTime() < Date.now()) throw Problem.unprocessable('deadline_passed', 'The deadline is in the past');
    const expires = new Date(Math.min(Date.now() + JOB_DAYS * 86400_000, deadline?.getTime() ?? Infinity));

    const jobId = await this.db.asEngine(async (trx) => {
      const raw = await trx.insertInto('raw_postings').values({
        source_key: 'employer_post', external_id: `emp-${randomToken(12)}`, payload: JSON.stringify({ ...input, employer_id: employerId }),
        content_hash: hmacHex('employer', `${input.title}\n${description}`), status: 'extracted', posted_by_user_id: userId,
      }).returning('id').executeTakeFirstOrThrow();
      const job = await trx.insertInto('jobs').values({
        employer_id: employerId, company_name: company, title: oneLine(input.title, 200), description, summary: firstWords(description),
        location_scope: input.location_scope, allowed_countries: input.location_scope === 'restricted' ? countries : [], is_remote: true,
        employment_type: input.employment_type ?? null, seniority: seniority(input.title),
        salary_min_minor: pay.min_minor ?? null, salary_max_minor: pay.max_minor ?? null, salary_currency: pay.currency?.toUpperCase() ?? null, salary_period: pay.period ?? null,
        skills: (input.skills ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean).slice(0, 15),
        apply_method: applyMethod, apply_email: applyEmail, apply_url: applyMethod === 'external_link' ? input.apply_url! : null,
        primary_source_key: 'employer_post', trust: verified ? 'verified_employer' : 'unverified', status: live ? 'live' : 'pending_review',
        posted_by_user_id: userId, deadline_at: deadline, expires_at: expires, max_applicants: input.max_applicants ?? null,
        autopilot_cap: Math.min(25, input.max_applicants ?? 25),
        category: categorise({ title: input.title, employment: input.employment_type ?? null, description }),
        dedupe_key: dedupeKey(company, input.title, true, countries),
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('job_sources').values({ job_id: job.id, raw_posting_id: raw.id, source_key: 'employer_post', apply_url: input.apply_url ?? null, is_primary: true }).execute();
      await trx.updateTable('raw_postings').set({ job_id: job.id }).where('id', '=', raw.id).execute();
      if (!live) {
        await trx.insertInto('moderation_items').values({
          subject_type: 'job', subject_id: job.id, risk_score: risk.score.toFixed(3),
          reason_internal: verified ? `Employer post flagged: ${risk.reasons.join(', ')}` : `Employer not verified yet (${emp.name})${risk.reasons.length ? `; flags: ${risk.reasons.join(', ')}` : ''}`,
        }).execute();
      }
      return job.id;
    });
    return this.jobs.get(jobId, { anyStatus: true });
  }

  /** Worker: close jobs that reached the employer's applicant cap. */
  async closeFullJobs(): Promise<{ closed: number }> {
    const r = await this.db.asEngine((trx) => sql`
      UPDATE jobs j SET status = 'expired', closed_reason = 'max_applicants', updated_at = now()
       WHERE j.status = 'live' AND j.max_applicants IS NOT NULL
         AND (SELECT count(*) FROM applications a WHERE a.job_id = j.id AND a.status NOT IN ('cancelled', 'failed')) >= j.max_applicants`.execute(trx));
    return { closed: Number(r.numAffectedRows ?? 0) };
  }

  // ---------------------------------------------------------------- ATS

  async connect(userId: string, employerId: string, input: { provider: AtsProvider; board_token: string; api_key: string }) {
    const m = await this.member(userId, employerId);
    if (m.verification !== 'verified') throw Problem.forbidden('employer_not_verified', 'Finish verifying the company before connecting an ATS');
    const check = await this.ats.check(input.provider, input.board_token, input.api_key);
    if (!check.ok) throw Problem.unprocessable('key_rejected', `${input.provider} did not accept this connection (${check.reason})`);
    const row = await this.db.asEngine(async (trx) => {
      const taken = await trx.selectFrom('employer_integrations').select(['employer_id', 'revoked_at']).where('provider', '=', input.provider).where('board_token', '=', input.board_token).executeTakeFirst();
      if (taken && taken.employer_id !== employerId && !taken.revoked_at) throw Problem.conflict('board_taken', 'This board is connected to another company');
      return trx.insertInto('employer_integrations').values({
        employer_id: employerId, provider: input.provider, board_token: input.board_token, api_key_ciphertext: this.box.seal(input.api_key),
        key_last4: input.api_key.slice(-4).padStart(4, '*'), connected_by: userId,
      }).onConflict((oc) => oc.columns(['provider', 'board_token']).doUpdateSet({
        employer_id: employerId, api_key_ciphertext: this.box.seal(input.api_key), key_last4: input.api_key.slice(-4).padStart(4, '*'), connected_by: userId, connected_at: sql`now()`, revoked_at: null,
      })).returning(['id', 'provider', 'board_token', 'key_last4', 'connected_at']).executeTakeFirstOrThrow();
    });
    return { id: row.id, provider: row.provider, board_token: row.board_token, key_last4: row.key_last4, connected_at: new Date(row.connected_at as unknown as string).toISOString() };
  }

  async disconnect(userId: string, employerId: string, integrationId: string) {
    await this.member(userId, employerId);
    const r = await this.db.asEngine((trx) =>
      trx.updateTable('employer_integrations').set({ revoked_at: sql`now()`, api_key_ciphertext: Buffer.alloc(0), key_last4: null })
        .where('id', '=', integrationId).where('employer_id', '=', employerId).where('revoked_at', 'is', null).returning('id').executeTakeFirst(),
    );
    if (!r) throw Problem.notFound('integration_not_found', 'There is no connected ATS here');
  }

  /** For the ATS sender (later): the stored key, decrypted only when used. */
  async keyFor(integrationId: string): Promise<string | null> {
    const r = await this.db.asEngine((trx) => trx.selectFrom('employer_integrations').select(['api_key_ciphertext', 'revoked_at']).where('id', '=', integrationId).executeTakeFirst());
    return r && !r.revoked_at && r.api_key_ciphertext.length ? this.box.open(r.api_key_ciphertext) : null;
  }
}

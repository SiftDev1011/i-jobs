import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { hmacHex, safeEqual, sixDigitCode } from '../common/crypto';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { RedisService } from '../redis/redis.service';

const CODE_MINUTES = 30;
const NEW_EMAILS_PER_DEVICE_DAY = 3;
const NEW_EMAILS_PER_NETWORK_DAY = 10;

/** Throwaway inboxes people use to get more free applies. Not complete; it covers the common ones. */
const DISPOSABLE = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'temp-mail.org', 'tempmail.com', 'tempmailo.com',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com',
  'emailondeck.com', 'burnermail.io', 'minuteinbox.com', '1secmail.com', 'mailnesia.com', 'spamgourmet.com', 'moakt.com', 'tmail.ws', 'tempr.email',
  'dropmail.me', 'mailpoof.com', 'inboxkitten.com', 'emailfake.com', 'tempinbox.com', 'mytemp.email', 'temp-mail.io',
]);

/**
 * Visitors on partner sites get a few free applies before signing up, counted against a verified
 * email. Sources that forbid sign-up gates (Remotive, Himalayas) never count.
 */
@Injectable()
export class VisitorService {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async sendCode(siteId: string, body: { email: string; device_hash: string; ip?: string }) {
    const email = body.email.trim().toLowerCase();
    const domain = email.split('@')[1] ?? '';
    if (DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`))) {
      throw Problem.unprocessable('disposable_email', 'Use your own email address, not a temporary one');
    }
    const identity = this.identity(email);
    const day = new Date().toISOString().slice(0, 10);
    const known = await this.db.forSite(siteId, (trx) => trx.selectFrom('apply_meter').select('id').where('identity_hash', '=', identity).executeTakeFirst());
    if (!known) {
      // New emails per device and per network each day.
      for (const [key, max] of [
        [`visitor:dev:${siteId}:${body.device_hash}:${day}`, NEW_EMAILS_PER_DEVICE_DAY],
        ...(body.ip ? [[`visitor:ip:${siteId}:${hmacHex(this.config.AUTH_PEPPER, body.ip)}:${day}`, NEW_EMAILS_PER_NETWORK_DAY] as const] : []),
      ] as const) {
        await this.redis.client.sadd(key, identity);
        await this.redis.client.expire(key, 2 * 86400);
        if ((await this.redis.client.scard(key)) > max) {
          await this.redis.client.srem(key, identity);
          throw Problem.unprocessable('device_limit', 'Too many new email addresses from this device today. Sign up to keep applying.');
        }
      }
    }
    const rate = await this.redis.hit(`visitor-code:${identity}`, 5, 3600);
    if (!rate.allowed) throw Problem.tooMany(rate.retryAfterSeconds, 'Too many codes. Try again later.');

    const code = sixDigitCode();
    await this.redis.client.set(this.codeKey(siteId, identity), JSON.stringify({ hash: hmacHex(this.config.AUTH_PEPPER, `${identity}:${code}`), tries: 0, device: body.device_hash, ip: body.ip ? hmacHex(this.config.AUTH_PEPPER, body.ip) : null }), 'EX', CODE_MINUTES * 60);
    await this.mail.send({ to: email, subject: `${code} is your i-jobs code`, text: `Your code is ${code}. It works for ${CODE_MINUTES} minutes.\n\nIf you didn't ask for it, ignore this email.` });
  }

  async apply(siteId: string, body: { email: string; code: string; job_id: string }) {
    const email = body.email.trim().toLowerCase();
    const identity = this.identity(email);
    const key = this.codeKey(siteId, identity);
    const raw = await this.redis.client.get(key);
    if (!raw) throw Problem.unauthorized('code_expired', 'This code has expired. Ask for a new one.');
    const stored = JSON.parse(raw) as { hash: string; tries: number; device: string; ip: string | null };
    if (stored.tries >= 5) throw Problem.unauthorized('code_locked', 'Too many wrong codes. Ask for a new one.');
    if (!safeEqual(stored.hash, hmacHex(this.config.AUTH_PEPPER, `${identity}:${body.code}`))) {
      await this.redis.client.set(key, JSON.stringify({ ...stored, tries: stored.tries + 1 }), 'KEEPTTL');
      throw Problem.unauthorized('code_invalid', 'That code is not right');
    }

    const job = await this.db.k
      .selectFrom('jobs as j')
      .innerJoin('job_sources as js', (j) => j.onRef('js.job_id', '=', 'j.id').on('js.is_primary', '=', true))
      .innerJoin('sources as s', 's.key', 'js.source_key')
      .select(['j.status', 'j.apply_method', 'j.apply_url', 'j.apply_email', 'j.title', 'js.apply_url as source_apply_url', 's.apply_via_source_link', 's.allow_signup_gate', 's.requires_credit', 's.credit_text', 's.display', 's.enabled'])
      .where('j.id', '=', body.job_id)
      .executeTakeFirst();
    if (!job || !job.enabled || job.display === 'disabled' || job.status !== 'live') throw Problem.notFound('job_not_found', 'There is no live job here');

    const site = await this.db.k.selectFrom('sites').select('free_apply_limit').where('id', '=', siteId).executeTakeFirstOrThrow();
    const applyUrl = job.apply_via_source_link
      ? (job.source_apply_url ?? job.apply_url)
      : job.apply_method === 'email' && job.apply_email
        ? `mailto:${job.apply_email}?subject=${encodeURIComponent(`Application for ${job.title}`)}`
        : job.apply_url;
    if (!applyUrl) throw Problem.unprocessable('no_apply_link', 'This job has no way to apply yet');

    const used = await this.db.forSite(siteId, async (trx) => {
      const row = await trx
        .insertInto('apply_meter')
        .values({ site_id: siteId, identity_hash: identity, applies_used: 0, device_hash: stored.device, ip_hash: stored.ip })
        .onConflict((oc) => oc.columns(['site_id', 'identity_hash']).doUpdateSet({ last_at: sql`now()` }))
        .returning(['id', 'applies_used'])
        .executeTakeFirstOrThrow();
      // Sources that forbid sign-up gates never count against the free applies.
      if (!job.allow_signup_gate) return row.applies_used;
      if (row.applies_used >= site.free_apply_limit) throw Problem.forbidden('signup_required', 'Sign up free to keep applying');
      await trx.updateTable('apply_meter').set({ applies_used: sql`applies_used + 1` }).where('id', '=', row.id).execute();
      return row.applies_used + 1;
    });

    return {
      apply_url: applyUrl,
      applies_left: Math.max(0, site.free_apply_limit - used),
      credit: job.requires_credit ? job.credit_text : null,
    };
  }

  private identity(email: string) {
    return hmacHex(this.config.AUTH_PEPPER, `visitor:${email}`);
  }

  private codeKey(siteId: string, identity: string) {
    return `vcode:${siteId}:${identity}`;
  }
}

import { isEmail } from '../common/email';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AccountService, MeView } from '../account/account.service';
import { AppConfig, CONFIG } from '../config/config';
import { hmacHex, randomToken, safeEqual, sixDigitCode } from '../common/crypto';
import { Problem } from '../common/problem';
import { Db } from '../db/db.service';
import { MailService } from '../messaging/mail.service';
import { SmsService } from '../messaging/sms.service';
import { RedisService } from '../redis/redis.service';
import { SitesService } from '../sites/sites.service';
import { revokedSessionKey } from './auth.guard';
import { TokensService } from './tokens.service';

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export interface SessionView {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: MeView;
}

type Target = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

export function normaliseTarget(raw: string): Target {
  const value = raw.trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (!isEmail(email)) {
      throw Problem.badRequest('invalid_request', 'Enter a valid email address', [{ field: 'target', message: 'Enter a valid email address' }]);
    }
    return { kind: 'email', value: email };
  }
  const phone = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) {
    throw Problem.badRequest('invalid_request', 'Enter an email or a phone number like +2348012345678', [
      { field: 'target', message: 'Use international format, for example +2348012345678' },
    ]);
  }
  return { kind: 'phone', value: phone };
}

/** How long an old refresh token still returns the tokens it was swapped for. */
const REFRESH_GRACE_SECONDS = 20;
const refreshGraceKey = (hash: string) => `refresh-grace:${hash}`;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisService,
    private readonly tokens: TokensService,
    private readonly sites: SitesService,
    private readonly account: AccountService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private codeHash(target: string, code: string) {
    return hmacHex(this.config.AUTH_PEPPER, `${target}:${code}`);
  }

  private ipHash(ip?: string) {
    return ip ? hmacHex(this.config.AUTH_PEPPER, ip) : null;
  }

  /** Sends a sign-in code. Always succeeds from the caller's view, so it never reveals who has an account. */
  async sendCode(rawTarget: string, ip?: string): Promise<void> {
    const target = normaliseTarget(rawTarget);
    if (target.kind !== 'email' && !this.sms.enabled) {
      throw Problem.unprocessable('phone_sign_in_off', 'Sign in with your email address. Phone sign-in isn’t available.');
    }
    const perTarget = await this.redis.hit(`code:target:${target.value}`, 5, 3600);
    const perIp = ip ? await this.redis.hit(`code:ip:${this.ipHash(ip)}`, 30, 3600) : { allowed: true, retryAfterSeconds: 0 };
    if (!perTarget.allowed || !perIp.allowed) {
      throw Problem.tooMany(Math.max(perTarget.retryAfterSeconds, perIp.retryAfterSeconds), 'Too many codes requested. Wait a little and try again.');
    }

    const site = await this.sites.ijobs();
    const code = sixDigitCode();
    await this.db.k
      .insertInto('auth_codes')
      .values({
        site_id: site.id,
        target: target.value,
        purpose: 'login',
        code_hash: this.codeHash(target.value, code),
        expires_at: sql`now() + make_interval(mins => ${CODE_MINUTES})`,
      })
      .execute();

    const text = `Your i-jobs code is ${code}. It expires in ${CODE_MINUTES} minutes. Never share it with anyone.`;
    if (target.kind === 'email') {
      await this.mail.send({ to: target.value, subject: `${code} is your i-jobs code`, text });
    } else {
      await this.sms.send({ to: target.value, text });
    }
  }

  /** Checks a code and starts a session. Creates the account on first sign-in. */
  /** Checks and uses up a code sent to a phone or email, without signing in (trial phone checks). */
  async verifyCode(rawTarget: string, code: string): Promise<string> {
    const target = normaliseTarget(rawTarget);
    const row = await this.db.k
      .selectFrom('auth_codes')
      .select(['id', 'code_hash', 'attempts', 'expires_at'])
      .where('target', '=', target.value)
      .where('purpose', '=', 'login')
      .where('used_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row || row.expires_at.getTime() < Date.now()) throw Problem.unauthorized('code_expired', 'This code has expired. Request a new one.');
    if (row.attempts >= MAX_ATTEMPTS) throw Problem.unauthorized('code_locked', 'Too many wrong tries. Request a new code.');
    if (!safeEqual(row.code_hash, this.codeHash(target.value, code))) {
      await this.db.k.updateTable('auth_codes').set({ attempts: row.attempts + 1 }).where('id', '=', row.id).execute();
      throw Problem.unauthorized('code_invalid', 'That code is not right. Check it and try again.');
    }
    await this.db.k.updateTable('auth_codes').set({ used_at: new Date() }).where('id', '=', row.id).execute();
    return target.value;
  }

  async signIn(rawTarget: string, code: string, meta: { ip?: string; userAgent?: string }): Promise<SessionView> {
    const target = normaliseTarget(rawTarget);
    const tries = await this.redis.hit(`signin:target:${target.value}`, 15, 900);
    if (!tries.allowed) throw Problem.tooMany(tries.retryAfterSeconds);

    const row = await this.db.k
      .selectFrom('auth_codes')
      .select(['id', 'code_hash', 'attempts', 'expires_at'])
      .where('target', '=', target.value)
      .where('purpose', '=', 'login')
      .where('used_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row || row.expires_at.getTime() < Date.now()) {
      throw Problem.unauthorized('code_expired', 'This code has expired. Request a new one.');
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw Problem.unauthorized('code_locked', 'Too many wrong tries. Request a new code.');
    }
    if (!safeEqual(row.code_hash, this.codeHash(target.value, code))) {
      await this.db.k.updateTable('auth_codes').set({ attempts: row.attempts + 1 }).where('id', '=', row.id).execute();
      throw Problem.unauthorized('code_invalid', 'That code is not right. Check it and try again.');
    }

    const site = await this.sites.ijobs();
    const { userId, refresh, sessionId } = await this.db.k.transaction().execute(async (trx) => {
      const used = await trx
        .updateTable('auth_codes')
        .set({ used_at: sql`now()` })
        .where('id', '=', row.id)
        .where('used_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!used) throw Problem.unauthorized('code_expired', 'This code was already used. Request a new one.');

      const column = target.kind === 'email' ? 'email' : 'phone';
      const verifiedColumn = target.kind === 'email' ? 'email_verified_at' : 'phone_verified_at';
      let user = await trx
        .selectFrom('users')
        .select(['id', 'status'])
        .where(column, '=', target.value)
        .executeTakeFirst();
      if (!user) {
        user = await trx
          .insertInto('users')
          .values({ [column]: target.value, [verifiedColumn]: sql`now()` })
          .returning(['id', 'status'])
          .executeTakeFirstOrThrow();
      } else {
        if (user.status !== 'active') throw Problem.forbidden('account_suspended', 'This account is suspended. Contact support.');
        await trx
          .updateTable('users')
          .set({ [verifiedColumn]: sql`coalesce(${sql.ref(verifiedColumn)}, now())` })
          .where('id', '=', user.id)
          .execute();
      }

      const refresh = randomToken(32);
      const session = await trx
        .insertInto('sessions')
        .values({
          user_id: user.id,
          site_id: site.id,
          refresh_hash: hmacHex(this.config.AUTH_PEPPER, refresh),
          user_agent: meta.userAgent?.slice(0, 300) ?? null,
          ip_hash: this.ipHash(meta.ip),
          expires_at: sql`now() + make_interval(days => ${this.config.REFRESH_TOKEN_DAYS})`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { userId: user.id, refresh, sessionId: session.id };
    });

    return this.sessionView(userId, sessionId, site.id, refresh);
  }

  /**
   * Swaps a refresh token for new tokens. Each refresh token works once; using an
   * old one again ends the session, because it means the token was copied.
   */
  async refresh(refreshToken: string): Promise<SessionView> {
    const hash = hmacHex(this.config.AUTH_PEPPER, refreshToken);
    const next = randomToken(32);
    const nextHash = hmacHex(this.config.AUTH_PEPPER, next);

    const session = await this.db.k
      .updateTable('sessions')
      .set({ refresh_hash: nextHash, previous_refresh_hash: hash, last_used_at: sql`now()` })
      .where('refresh_hash', '=', hash)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .returning(['id', 'user_id', 'site_id'])
      .executeTakeFirst();

    if (!session) {
      // Two requests from the same browser often refresh at the same moment (a web app's
      // middleware, parallel page loads). For a few seconds after a rotation, the old token
      // gets the same new tokens back instead of ending the session.
      const grace = await this.redis.client.get(refreshGraceKey(hash));
      if (grace) return JSON.parse(grace) as SessionView;
      const reused = await this.db.k
        .updateTable('sessions')
        .set({ revoked_at: sql`now()`, revoked_reason: 'refresh_token_reused' })
        .where('previous_refresh_hash', '=', hash)
        .where('revoked_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (reused) await this.markRevoked(reused.id);
      throw Problem.unauthorized('session_ended', 'Sign in again');
    }
    const view = await this.sessionView(session.user_id, session.id, session.site_id, next);
    await this.redis.client.set(refreshGraceKey(hash), JSON.stringify(view), 'EX', REFRESH_GRACE_SECONDS);
    return view;
  }

  async signOut(sessionId: string): Promise<void> {
    await this.db.k
      .updateTable('sessions')
      .set({ revoked_at: sql`now()`, revoked_reason: 'signed_out' })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
    await this.markRevoked(sessionId);
  }

  private async markRevoked(sessionId: string) {
    // Access tokens live a few minutes; remember the ended session at least that long.
    await this.redis.client.set(revokedSessionKey(sessionId), '1', 'EX', this.tokens.accessSeconds + 60);
  }

  private async sessionView(userId: string, sessionId: string, siteId: string, refresh: string): Promise<SessionView> {
    return {
      access_token: await this.tokens.signAccess({ userId, sessionId, siteId }),
      refresh_token: refresh,
      expires_in: this.tokens.accessSeconds,
      user: await this.account.getMe(userId, siteId),
    };
  }
}

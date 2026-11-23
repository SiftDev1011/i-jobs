import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { AppConfig, CONFIG } from '../config/config';
import { Problem } from '../common/problem';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  siteId: string;
}

const ISSUER = 'ijobs-engine';
const AUDIENCE = 'ijobs';

/** Short-lived access tokens (JWT, HS256). Refresh tokens are random strings stored hashed. */
@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessSeconds(): number {
    return this.config.ACCESS_TOKEN_MINUTES * 60;
  }

  async signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ sid: c.sessionId, site: c.siteId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.site !== 'string') {
        throw Problem.unauthorized('token_invalid', 'Sign in again');
      }
      return { userId: payload.sub, sessionId: payload.sid, siteId: payload.site };
    } catch (e) {
      if (e instanceof Problem) throw e;
      if (e instanceof errors.JWTExpired) throw Problem.unauthorized('token_expired', 'Your session timed out. Refresh it to continue.');
      throw Problem.unauthorized('token_invalid', 'Sign in again');
    }
  }
}

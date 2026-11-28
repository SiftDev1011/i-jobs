/**
 * i-jobs for partner sites (Remote Hustle, School1, …). One file, no dependencies.
 *
 * SERVER ONLY. It holds your site key: never import it into browser code or a "use client" file.
 * Works in Node 18+, Next.js route handlers and server actions, Express, and any runtime with fetch.
 *
 *   import { createIjobs } from './ijobs';
 *   const ijobs = createIjobs({ siteKey: process.env.IJOBS_SITE_KEY! });
 *
 *   await ijobs.linkUser({ external_user_id: user.id, email: user.email, email_verified: true });
 *   const me = ijobs.forUser(user.id);
 *   const { items } = await me.matches();
 *
 * Every failed call throws an IjobsError with the API's `status`, `code` and a `title` you can show people.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const DEFAULT_API_URL = 'https://ijobs-api.remotehustle.name.ng';

export type IjobsOptions = {
  /** Your site's key from i-jobs (sk_…). Keep it in a server environment variable. */
  siteKey: string;
  /** Defaults to the live i-jobs API. */
  apiUrl?: string;
  /** Give up on a call after this long. Default 15 seconds. */
  timeoutMs?: number;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
};

export class IjobsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly body: unknown,
  ) {
    super(`${status} ${code}: ${title}`);
    this.name = 'IjobsError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;
type Call = { user?: string; query?: Query; body?: unknown; idempotencyKey?: string };

export type Page<T> = { items: T[]; next_cursor: string | null };
export type LinkResult = { user_id: string | null; linked: boolean; consent_url?: string | null };
export type Training = { id: string; title: string; url: string; skills?: string[]; duration_minutes?: number | null; is_free?: boolean; suitable_for_minors?: boolean };
export type WebhookEvent = 'application.status_changed' | 'match.created' | 'work.ready' | 'membership.updated';
// Job, match, profile and application objects are as in the API reference (api/reference.html).
// They're typed loosely here so this file keeps working as the API adds fields.
type Obj = Record<string, any>;

export function createIjobs(opts: IjobsOptions) {
  if (!opts?.siteKey?.startsWith('sk_')) throw new Error('i-jobs: siteKey is missing or not a site key (it starts with sk_)');
  const base = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '') + '/v1';
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function call<T>(method: string, path: string, c: Call = {}): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(c.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json', 'x-site-key': opts.siteKey };
    if (c.user) headers['x-site-user'] = c.user;
    if (c.body !== undefined) headers['content-type'] = 'application/json';
    if (c.idempotencyKey) headers['idempotency-key'] = c.idempotencyKey;
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body: c.body === undefined ? undefined : JSON.stringify(c.body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new IjobsError(0, 'network_error', 'Couldn’t reach i-jobs. Try again in a moment.', { cause: String(e) });
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) throw new IjobsError(res.status, json?.code ?? `http_${res.status}`, json?.title ?? 'Something went wrong at i-jobs.', json ?? text);
    return json as T;
  }

  /** Everything you do on behalf of one of your users. Link them first with linkUser. */
  function forUser(externalUserId: string) {
    if (!externalUserId) throw new Error('i-jobs: forUser needs your user id');
    const u = externalUserId;
    return {
      // ---- account
      /** Includes age_band and features_locked: true for under-13s, and for 13–17s until a parent approves. */
      account: () => call<Obj>('GET', '/me', { user: u }),
      /** For 13–17s (School1): emails the parent a link to approve. Job features unlock once they do. */
      requestParentApproval: (parent: { guardian_name: string; guardian_email: string }) =>
        call<{ status: 'sent' }>('POST', '/me/guardian', { user: u, body: parent }),

      // ---- profile and CV
      profile: () => call<Obj>('GET', '/me/profile', { user: u }),
      updateProfile: (changes: Obj) => call<Obj>('PATCH', '/me/profile', { user: u, body: changes }),
      /** Step 1 of a CV upload. Send upload_url to the browser, which PUTs the file there with its Content-Type. */
      cvUploadLink: (file: { file_name: string; content_type: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; size_bytes: number }) =>
        call<{ upload_id: string; upload_url: string; expires_at: string }>('POST', '/me/cv', { user: u, body: file }),
      /** Step 2, after the browser's upload finished: read the CV. Usually 202 with status "scheduled" or "processing"; a work.ready webhook follows. */
      parseCv: (uploadId: string) => call<Obj>('POST', '/me/cv/parse', { user: u, body: { upload_id: uploadId } }),
      autopilot: () => call<Obj>('GET', '/me/autopilot', { user: u }),
      updateAutopilot: (rules: Obj) => call<Obj>('PUT', '/me/autopilot', { user: u, body: rules }),

      // ---- matches and applying
      matches: (q: { status?: 'new' | 'seen' | 'saved' | 'dismissed'; min_score?: number; cursor?: string; limit?: number } = {}) =>
        call<Page<Obj>>('GET', '/me/matches', { user: u, query: q }),
      setMatch: (jobId: string, status: 'seen' | 'saved' | 'dismissed') => call<Obj>('PATCH', `/me/matches/${enc(jobId)}`, { user: u, body: { status } }),
      queue: (q: { cursor?: string; limit?: number } = {}) => call<Page<Obj>>('GET', '/me/queue', { user: u, query: q }),
      /** A tailored cover note and answers for one job. 202 with status "scheduled" when today's AI budget is used up. */
      applyPack: (jobId: string) => call<Obj>('POST', `/me/queue/${enc(jobId)}/pack`, { user: u }),
      /** Call when the person says they applied. Safe to retry with the same key. */
      markApplied: (jobId: string, idempotencyKey: string = randomUUID()) =>
        call<Obj>('POST', `/me/queue/${enc(jobId)}/applied`, { user: u, idempotencyKey }),
      applications: (q: { status?: string; cursor?: string; limit?: number } = {}) => call<Page<Obj>>('GET', '/me/applications', { user: u, query: q }),
      applicationsSummary: () => call<Obj>('GET', '/me/applications/summary', { user: u }),

      // ---- notifications
      notifications: (q: { unread?: boolean; cursor?: string; limit?: number } = {}) => call<Page<Obj>>('GET', '/me/notifications', { user: u, query: q }),
      /** Leave ids out to mark all as read. */
      markNotificationsRead: (ids?: string[]) => call<void>('POST', '/me/notifications/read', { user: u, body: ids ? { ids } : {} }),
    };
  }

  return {
    /**
     * Call when one of your users opens the job features (it's cheap to call every time).
     * - linked: true → go ahead with forUser(id).
     * - linked: false with consent_url → they already have an i-jobs account. Show the link; they must
     *   agree on i-jobs before anything is shared. Call linkUser again afterwards.
     * Throws 422 email_not_verified if email_verified is false: verify emails on your side first.
     */
    linkUser: (u: { external_user_id: string; email: string; email_verified: boolean; full_name?: string; date_of_birth?: string; completed_trainings?: string[] }) =>
      call<LinkResult>('POST', '/partner/users', { body: u }),
    forUser,

    // ---- public jobs (no user needed)
    jobs: (q: { q?: string; location?: string; employment_type?: string; category?: string; verified_only?: boolean; min_pay_monthly?: number; currency?: string; cursor?: string; limit?: number } = {}) =>
      call<Page<Obj>>('GET', '/jobs', { query: q }),
    job: (jobId: string) => call<Obj>('GET', `/jobs/${enc(jobId)}`),
    similarJobs: (jobId: string, limit = 8) => call<{ items: Obj[] }>('GET', `/jobs/${enc(jobId)}/similar`, { query: { limit } }),

    // ---- your site
    /** Your course catalogue. Skill gaps then suggest your courses, and never ones the person already finished. */
    putTrainings: (trainings: Training[]) => call<void>('PUT', '/partner/trainings', { body: trainings }),
    webhooks: {
      list: () => call<Obj[]>('GET', '/partner/webhooks'),
      /** The response's `secret` is shown once: store it (e.g. IJOBS_WEBHOOK_SECRET). */
      create: (url: string, events: WebhookEvent[]) => call<Obj & { secret: string }>('POST', '/partner/webhooks', { body: { url, events } }),
      remove: (endpointId: string) => call<void>('DELETE', `/partner/webhooks/${enc(endpointId)}`),
    },
  };
}

export type Ijobs = ReturnType<typeof createIjobs>;

/**
 * Checks an i-jobs webhook before you trust it. Pass the RAW request body (not parsed JSON),
 * the X-Ijobs-Signature header and your webhook secret. Rejects anything older than 5 minutes.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null | undefined, secret: string, toleranceSec = 300): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1 ?? '';
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

const enc = encodeURIComponent;

import { XMLParser } from 'fast-xml-parser';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodySnippet: string,
  ) {
    super(`HTTP ${status} from ${redact(url)}${bodySnippet ? `: ${bodySnippet}` : ''}`);
  }
}

export type FetchFn = typeof fetch;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  json?: unknown;
  /** Extra tries after the first on 429 and 5xx. */
  retries?: number;
  timeoutMs?: number;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'position', 'jobDescription', 'location', 'entry'].includes(name),
});

/**
 * HTTP for connectors and link checks: a clear user agent, timeouts, polite retries
 * that honour Retry-After, and a swappable fetch for tests.
 */
export class Http {
  constructor(
    private readonly userAgent: string,
    private readonly timeoutMs: number,
    private fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Tests swap in a fake. */
  useFetch(fn: FetchFn) {
    this.fetchFn = fn;
  }

  async request(url: string, opts: RequestOptions = {}): Promise<Response> {
    const retries = opts.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
            ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...opts.headers,
          },
          body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
          signal: ctrl.signal,
          redirect: 'follow',
        });
      } catch (e) {
        clearTimeout(timer);
        if (attempt < retries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        const msg = (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message;
        throw new HttpError(0, url, msg);
      }
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = retryAfterMs(res.headers.get('retry-after')) ?? backoff(attempt);
        if (wait > 60_000) throw new HttpError(res.status, url, `retry after ${Math.round(wait / 1000)}s`);
        await res.body?.cancel().catch(() => undefined);
        await this.sleep(wait);
        continue;
      }
      return res;
    }
  }

  async json<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(url, opts);
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 200));
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(res.status, url, `not JSON: ${text.slice(0, 120)}`);
    }
  }

  async text(url: string, opts: RequestOptions = {}): Promise<string> {
    const res = await this.request(url, opts);
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 200));
    return text;
  }

  async xml<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
    return parseXml<T>(await this.text(url, opts));
  }
}

export function parseXml<T = any>(text: string): T {
  return xml.parse(text) as T;
}

function backoff(attempt: number) {
  return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

function retryAfterMs(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** Keys and app ids never reach logs. */
export function redact(url: string): string {
  return url.replace(/([?&](app_key|app_id|appname|key|api_key|token|affid)=)[^&]+/gi, '$1***').replace(/(jooble\.org\/api\/)[^/?]+/, '$1***');
}

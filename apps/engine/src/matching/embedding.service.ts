import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { RedisService } from '../redis/redis.service';

export class EmbedRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Embeddings rate limited; retry in ${retryAfterSeconds}s`);
  }
}

export type EmbedFn = (body: { input: string[]; model: string; input_type: 'document' | 'query'; output_dimension: number }) => Promise<{ status: number; json: any }>;

export const DIMENSIONS = 1024;

/**
 * Voyage embeddings: jobs as documents, profiles as queries (the member is "searching" for jobs).
 * Keeps inside Voyage's per-minute limits through Redis, shared by every worker.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger('Embeddings');
  private fn: EmbedFn;
  private faked = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.fn = (body) => this.voyage(body);
  }

  useEmbed(fn: EmbedFn) {
    this.fn = fn;
    this.faked = true;
  }

  get enabled() {
    return !!this.config.VOYAGE_API_KEY || this.faked;
  }

  async embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
    if (!texts.length) return [];
    const tokens = texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    const minute = Math.floor(Date.now() / 60_000);
    const [calls, used] = await Promise.all([
      this.redis.client.incr(`emb:rpm:${minute}`),
      this.redis.client.incrby(`emb:tpm:${minute}`, tokens),
    ]);
    await this.redis.client.expire(`emb:rpm:${minute}`, 120);
    await this.redis.client.expire(`emb:tpm:${minute}`, 120);
    if (calls > this.config.VOYAGE_RPM || used > this.config.VOYAGE_TPM) {
      await this.redis.client.decrby(`emb:tpm:${minute}`, tokens);
      throw new EmbedRateLimited(61 - new Date().getUTCSeconds());
    }
    const res = await this.fn({ input: texts, model: this.config.VOYAGE_MODEL, input_type: inputType, output_dimension: DIMENSIONS });
    if (res.status === 429) throw new EmbedRateLimited(60);
    if (res.status >= 400) throw new Error(`Voyage said ${res.status}: ${JSON.stringify(res.json?.detail ?? res.json).slice(0, 200)}`);
    const data = [...(res.json?.data ?? [])].sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding as number[]);
    if (data.length !== texts.length || data.some((v) => v.length !== DIMENSIONS)) throw new Error('Voyage returned the wrong number or size of embeddings');
    return data;
  }

  /** How many texts fit in one call, given the per-minute token limit. */
  batchSize(texts: string[]): number {
    const budget = Math.floor(this.config.VOYAGE_TPM * 0.9);
    let n = 0;
    let used = 0;
    for (const t of texts) {
      used += Math.ceil(t.length / 4);
      if (used > budget || n >= 64) break;
      n++;
    }
    return Math.max(1, n);
  }

  private async voyage(body: Parameters<EmbedFn>[0]) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`${this.config.VOYAGE_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, truncation: true }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = { detail: text.slice(0, 200) };
      }
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** pgvector's text form. */
export function toVector(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}

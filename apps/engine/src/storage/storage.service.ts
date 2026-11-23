import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppConfig, CONFIG } from '../config/config';

export interface StoredInfo {
  size: number;
  contentType: string | null;
}

/**
 * Private files (CVs). Cloudflare R2 through its S3 API in production. For development, `local`
 * keeps files in a folder (shared by the API and the worker) behind signed /v1/dev/files links;
 * `memory` is for tests. Browsers upload straight to storage with a short-lived signed link.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  /** Memory driver only. */
  readonly memory = new Map<string, { body: Buffer; contentType: string }>();
  /** Local driver only. */
  private readonly dir: string | null;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.bucket = config.R2_BUCKET;
    this.s3 =
      config.STORAGE_DRIVER === 'r2'
        ? new S3Client({
            region: 'auto',
            endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY! },
          })
        : null;
    this.dir = config.STORAGE_DRIVER === 'local' ? path.resolve(config.STORAGE_DIR) : null;
  }

  get isLocal() {
    return this.dir !== null;
  }

  // ---------------------------------------------------------------- local driver (development)

  /** Signs a local file link: method, key, type, size and expiry. */
  localSignature(method: 'PUT' | 'GET', key: string, exp: number, extra = ''): string {
    return createHmac('sha256', this.config.SECRETS_KEY).update(`${method}\n${key}\n${exp}\n${extra}`).digest('hex');
  }

  localCheck(method: 'PUT' | 'GET', key: string, exp: number, sig: string, extra = ''): boolean {
    if (!this.dir || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const want = Buffer.from(this.localSignature(method, key, exp, extra));
    const got = Buffer.from(sig ?? '');
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private localLink(method: 'PUT' | 'GET', key: string, seconds: number, extra: Record<string, string> = {}) {
    const exp = Math.floor(Date.now() / 1000) + seconds;
    const extraStr = Object.values(extra).join('\n');
    const q = new URLSearchParams({ ...extra, exp: String(exp), sig: this.localSignature(method, key, exp, extraStr) });
    return `${this.config.PUBLIC_API_URL}/v1/dev/files/${encodeURIComponent(key)}?${q}`;
  }

  private localPath(key: string) {
    const p = path.resolve(this.dir!, key);
    if (!p.startsWith(this.dir! + path.sep)) throw new Error('Bad file key');
    return p;
  }

  private async localMeta(key: string): Promise<{ contentType: string } | null> {
    try {
      return JSON.parse(await readFile(`${this.localPath(key)}.meta.json`, 'utf8'));
    } catch {
      return null;
    }
  }

  /** A PUT link that only accepts this exact type and size, for 15 minutes. */
  async uploadUrl(key: string, contentType: string, size: number, seconds = 900): Promise<string> {
    if (this.dir) return this.localLink('PUT', key, seconds, { type: contentType, size: String(size) });
    if (!this.s3) return `https://uploads.invalid/memory/${encodeURIComponent(key)}`;
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn: seconds, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** A short-lived link to download a private file. */
  async downloadUrl(key: string, filename: string, seconds = 3600): Promise<string> {
    if (this.dir) return this.localLink('GET', key, seconds, { name: filename });
    if (!this.s3) return `https://downloads.invalid/memory/${encodeURIComponent(key)}`;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, '')}"` }),
      { expiresIn: seconds },
    );
  }

  async stat(key: string): Promise<StoredInfo | null> {
    if (this.dir) {
      try {
        const st = await stat(this.localPath(key));
        return { size: st.size, contentType: (await this.localMeta(key))?.contentType ?? null };
      } catch {
        return null;
      }
    }
    if (!this.s3) {
      const f = this.memory.get(key);
      return f ? { size: f.body.length, contentType: f.contentType } : null;
    }
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async get(key: string, maxBytes = 6 * 1024 * 1024): Promise<Buffer> {
    if (this.dir) {
      const bytes = await readFile(this.localPath(key));
      if (bytes.length > maxBytes) throw new Error(`File at ${key} is larger than ${maxBytes} bytes`);
      return bytes;
    }
    if (!this.s3) {
      const f = this.memory.get(key);
      if (!f) throw new Error(`No file at ${key}`);
      return f.body;
    }
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = Buffer.from(await r.Body!.transformToByteArray());
    if (bytes.length > maxBytes) throw new Error(`File at ${key} is larger than ${maxBytes} bytes`);
    return bytes;
  }

  /** Server-side writes (tests, generated files later). */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.dir) {
      const p = this.localPath(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
      await writeFile(`${p}.meta.json`, JSON.stringify({ contentType }));
      return;
    }
    if (!this.s3) {
      this.memory.set(key, { body, contentType });
      return;
    }
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    if (this.dir) {
      await rm(this.localPath(key), { force: true });
      await rm(`${this.localPath(key)}.meta.json`, { force: true });
      return;
    }
    if (!this.s3) {
      this.memory.delete(key);
      return;
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

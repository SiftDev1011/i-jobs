import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../src/config/config';
import { StorageService } from '../src/storage/storage.service';

describe('Local file storage (development)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ijobs-store-'));
  const storage = new StorageService({ STORAGE_DRIVER: 'local', STORAGE_DIR: dir, SECRETS_KEY: 'test-secrets-key-0123456789abcdef0123456789', PUBLIC_API_URL: 'http://localhost:3000', R2_BUCKET: 'x' } as unknown as AppConfig);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('signs upload links for one key, type and size, and refuses anything else', async () => {
    const u = new URL(await storage.uploadUrl('cv/u1/a.pdf', 'application/pdf', 1234));
    expect(u.pathname).toBe('/v1/dev/files/cv%2Fu1%2Fa.pdf');
    const q = Object.fromEntries(u.searchParams);
    const extra = `${q.type}\n${q.size}`;
    expect(storage.localCheck('PUT', 'cv/u1/a.pdf', Number(q.exp), q.sig, extra)).toBe(true);
    expect(storage.localCheck('PUT', 'cv/u1/b.pdf', Number(q.exp), q.sig, extra)).toBe(false);
    expect(storage.localCheck('PUT', 'cv/u1/a.pdf', Number(q.exp), q.sig, `${q.type}\n9999`)).toBe(false);
    expect(storage.localCheck('GET', 'cv/u1/a.pdf', Number(q.exp), q.sig, extra)).toBe(false);
    expect(storage.localCheck('PUT', 'cv/u1/a.pdf', Math.floor(Date.now() / 1000) - 5, q.sig, extra)).toBe(false);
  });

  it('stores, reads, describes and deletes files on disk', async () => {
    await storage.put('cv/u1/a.pdf', Buffer.from('%PDF-1.4 hello'), 'application/pdf');
    expect(await storage.stat('cv/u1/a.pdf')).toEqual({ size: 14, contentType: 'application/pdf' });
    expect((await storage.get('cv/u1/a.pdf')).toString()).toBe('%PDF-1.4 hello');
    await storage.delete('cv/u1/a.pdf');
    expect(await storage.stat('cv/u1/a.pdf')).toBeNull();
  });

  it('never leaves its folder', async () => {
    await expect(storage.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow('Bad file key');
  });
});

import type { AppConfig } from '../src/config/config';
import { StorageService } from '../src/storage/storage.service';

/** Upload links for R2 are made without contacting R2, so this runs offline. */
describe('R2 upload links', () => {
  const storage = new StorageService({
    STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'ijobs-files',
  } as AppConfig);

  it('carry no checksum, so a browser upload of the real file is accepted', async () => {
    const url = new URL(await storage.uploadUrl('cv/abc.pdf', 'application/pdf', 123_456));
    expect(`${url.host}${url.pathname}`).toBe('acc.r2.cloudflarestorage.com/ijobs-files/cv/abc.pdf');
    expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
  });

  it('only accept the declared type and size, for 15 minutes', async () => {
    const url = new URL(await storage.uploadUrl('cv/abc.pdf', 'application/pdf', 123_456));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });
});

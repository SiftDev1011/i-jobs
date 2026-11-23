import { Injectable } from '@nestjs/common';

export type AtsProvider = 'greenhouse' | 'lever' | 'ashby';

/**
 * One cheap, read-only call per provider to check a key before we store it.
 * - Greenhouse: the Job Board API key is only used to submit applications and has no read call,
 *   so we check the board exists. The key itself is proved on the first application.
 * - Lever: list one posting with the key.
 * - Ashby: apiKey.info with the key.
 * Swap `fetchFn` in tests.
 */
@Injectable()
export class AtsKeyChecker {
  fetchFn: typeof fetch = fetch;

  async check(provider: AtsProvider, boardToken: string, apiKey: string): Promise<{ ok: boolean; reason?: string }> {
    const basic = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
    try {
      if (provider === 'greenhouse') {
        const r = await this.call(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}`, { method: 'GET' });
        return r.ok ? { ok: true } : { ok: false, reason: r.status === 404 ? 'board_not_found' : `http_${r.status}` };
      }
      if (provider === 'lever') {
        const r = await this.call('https://api.lever.co/v1/postings?limit=1', { method: 'GET', headers: { authorization: basic } });
        return r.ok ? { ok: true } : { ok: false, reason: r.status === 401 || r.status === 403 ? 'key_rejected' : `http_${r.status}` };
      }
      const r = await this.call('https://api.ashbyhq.com/apiKey.info', { method: 'POST', headers: { authorization: basic, 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) return { ok: false, reason: r.status === 401 || r.status === 403 ? 'key_rejected' : `http_${r.status}` };
      const body = (await r.json().catch(() => null)) as { success?: boolean } | null;
      return body?.success ? { ok: true } : { ok: false, reason: 'key_rejected' };
    } catch (e) {
      return { ok: false, reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network_error' };
    }
  }

  private call(url: string, init: RequestInit) {
    return this.fetchFn(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'i-jobs/1', ...(init.headers as object) } });
  }
}

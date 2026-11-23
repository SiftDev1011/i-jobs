import { engine } from '@/lib/engine';

/** Streams a paid batch's codes as a CSV download. The engine checks the batch is this owner's. */
export async function GET(_: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return new Response('Not found', { status: 404 });
  const r = await (await engine()).GET('/owner/code-batches/{batchId}/codes', { params: { path: { batchId } }, parseAs: 'text' });
  if (!r.response.ok) {
    const msg = r.response.status === 402 ? 'This batch has not been paid for yet.' : r.response.status === 401 ? 'Sign in again to download.' : 'This batch isn’t available.';
    return new Response(msg, { status: r.response.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response(r.data as unknown as string, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ijobs-codes-${batchId.slice(0, 8)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

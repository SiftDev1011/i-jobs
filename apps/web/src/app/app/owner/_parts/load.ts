import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { engine, maybe } from '@/lib/engine';

/** The owner's community, once per request (layout and page both need it). */
export const loadCommunity = cache(async (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = maybe(await (await engine()).GET('/owner/communities/{communityId}', { params: { path: { communityId: id } } }));
  if (!c) notFound();
  return c;
});

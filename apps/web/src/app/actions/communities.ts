'use server';

import { engine, must } from '@/lib/engine';

export interface CommunityHit { id: string; name: string; slug: string; member_count: number; verified: boolean }

/** Verified communities matching a city, skill or name. */
export async function searchCommunities(q: string): Promise<CommunityHit[]> {
  const api = await engine({ anonymous: true });
  const page = must(await api.GET('/communities', { params: { query: { q: q.trim().slice(0, 80) || undefined, limit: 12 } } }));
  return (page.items ?? []).map((c) => ({ id: c.id!, name: c.name ?? '', slug: c.slug ?? '', member_count: c.member_count ?? 0, verified: !!c.verified }));
}

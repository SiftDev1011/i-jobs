'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { engine, EngineError, must } from '@/lib/engine';

export type JoinState = { error?: string } | null;

/** Join a community with an invite code or link slug, or redeem a prepaid access code. */
export async function joinCommunity(_prev: JoinState, form: FormData): Promise<JoinState> {
  const code = String(form.get('code') ?? '').trim();
  const via = form.get('via') === 'invite_link' ? 'invite_link' : 'invite_code';
  let membershipId: string;
  try {
    const api = await engine();
    const m = must(await api.POST('/join', { body: { code, via } }));
    membershipId = m.id;
  } catch (e) {
    if (e instanceof EngineError) {
      if (e.status === 401) redirect(`/sign-in?next=${encodeURIComponent(`/join/${code}`)}`);
      if (e.code === 'already_member') redirect('/app');
      if (e.code === 'code_used') return { error: 'This code has already been used. Ask your community owner for another.' };
      if (e.status === 404) return { error: 'This invite is no longer active. Check it with your community owner.' };
      return { error: e.message };
    }
    return { error: 'We couldn’t reach i-jobs. Try again in a minute.' };
  }
  redirect(`/app?joined=${membershipId}`);
}

/** Pay a membership: Paga's checkout page takes over from here. */
export async function startCheckout(form: FormData): Promise<void> {
  const id = String(form.get('membership') ?? '');
  const api = await engine();
  const r = await api.POST('/memberships/{membershipId}/checkout', {
    params: { path: { membershipId: id }, header: { 'Idempotency-Key': randomUUID() } },
  });
  const c = must(r);
  redirect(c.checkout_url);
}

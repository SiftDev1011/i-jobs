'use client';

import { useActionState } from 'react';
import { joinCommunity, type JoinState } from '@/app/actions/membership';

export function JoinButton({ code, via, label }: { code: string; via: 'invite_link' | 'invite_code'; label: string }) {
  const [state, act, pending] = useActionState<JoinState, FormData>(joinCommunity, null);
  return (
    <form action={act}>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="via" value={via} />
      <button className="btn btn-green btn-block" disabled={pending}>{pending ? 'Joining…' : label}</button>
      {state?.error && <p className="err" role="alert">{state.error}</p>}
    </form>
  );
}

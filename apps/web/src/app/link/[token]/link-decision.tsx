'use client';

import { useState, useTransition } from 'react';
import { decidePartnerLink } from '@/app/actions/member';

export function LinkDecision({ token, site }: { token: string; site: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (accept: boolean) => start(async () => { const r = await decidePartnerLink(token, accept); if (r && !r.ok) setError(r.error); });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button className="btn btn-green btn-block" disabled={pending} onClick={() => go(true)}>Yes, link to {site}</button>
      <button className="btn btn-plain btn-block" disabled={pending} onClick={() => go(false)}>No thanks</button>
      {error && <p className="err">{error}</p>}
    </div>
  );
}

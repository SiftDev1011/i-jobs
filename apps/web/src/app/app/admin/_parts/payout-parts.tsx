'use client';

import { useActionState } from 'react';
import { markPayoutPaid, releasePayout } from '@/app/actions/admin';
import type { Result } from '@/lib/act';
import { ActionButton } from '../../_parts/action-button';
import u from '../../_ui/ui.module.css';

export function Release({ id }: { id: string }) {
  return <ActionButton run={() => releasePayout(id)} label="Release" confirm="Release for sending?" busy="Releasing…" done="Released" className="btn btn-green btn-sm" />;
}

export function MarkPaid({ id }: { id: string }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(markPayoutPaid.bind(null, id), null);
  if (r?.ok) return <span className="muted-sm">Marked paid.</span>;
  return (
    <form action={act} className={u.row} style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input className="input" name="reference" placeholder="Transfer reference" required minLength={4} maxLength={100} style={{ width: 170, marginTop: 0 }} />
      <button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Saving…' : 'Mark paid'}</button>
      {r && !r.ok && <span className="err" style={{ marginTop: 0 }}>{r.error}</span>}
    </form>
  );
}

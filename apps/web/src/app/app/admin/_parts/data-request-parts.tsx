'use client';

import { useActionState } from 'react';
import { closeDataRequest } from '@/app/actions/admin';
import type { Result } from '@/lib/act';
import u from '../../_ui/ui.module.css';

export function CloseRequest({ id, type }: { id: string; type: string }) {
  const [done, actDone, p1] = useActionState<Result | null, FormData>(closeDataRequest.bind(null, id, 'done'), null);
  const [refused, actRefuse, p2] = useActionState<Result | null, FormData>(closeDataRequest.bind(null, id, 'refused'), null);
  const r = done ?? refused;
  if (r?.ok) return <span className="muted-sm">Closed.</span>;
  return (
    <form className={u.form} style={{ gap: 8 }}>
      <input className="input" name="note" placeholder="Note (audit log)" maxLength={2000} style={{ minWidth: 180 }} />
      <span className={u.row} style={{ gap: 6 }}>
        {type !== 'delete' && <button formAction={actDone} className="btn btn-green btn-sm" disabled={p1 || p2}>Done</button>}
        <button formAction={actRefuse} className="btn btn-line btn-sm" disabled={p1 || p2}>{type === 'delete' ? 'Stop the deletion' : 'Refuse'}</button>
      </span>
      {r && !r.ok && <span className="err">{r.error}</span>}
    </form>
  );
}

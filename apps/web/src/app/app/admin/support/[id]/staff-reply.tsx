'use client';

import { useActionState, useRef } from 'react';
import { staffReply } from '@/app/actions/admin';
import type { Result } from '@/lib/act';
import u from '../../../_ui/ui.module.css';

export function StaffReply({ ticketId }: { ticketId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [r, act, pending] = useActionState<Result | null, FormData>(async (p, f) => {
    const out = await staffReply(ticketId, p, f);
    if (out.ok) form.current?.reset();
    return out;
  }, null);
  return (
    <form ref={form} action={act} className={u.form}>
      <div className={u.field}><label htmlFor="body">Reply to the member</label><textarea className="input" id="body" name="body" rows={5} required maxLength={5000} /><span className={u.help}>They get it in the app and by email.</span></div>
      <label className={u.check} style={{ alignSelf: 'flex-start' }}><input type="checkbox" name="resolve" /> Mark as resolved</label>
      {r && (r.ok ? <p className={`${u.notice} ${u.good}`} role="status">Sent.</p> : <p className="err" role="alert">{r.error}</p>)}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending…' : 'Send reply'}</button></div>
    </form>
  );
}

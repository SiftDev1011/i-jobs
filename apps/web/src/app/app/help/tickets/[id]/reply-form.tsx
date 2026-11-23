'use client';

import { useActionState, useRef } from 'react';
import { replyTicket, type Result } from '@/app/actions/member';
import u from '../../../_ui/ui.module.css';

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [r, act, pending] = useActionState<Result | null, FormData>(async (p, f) => { const res = await replyTicket(p, f); if (res.ok) form.current?.reset(); return res; }, null);
  return (
    <form ref={form} action={act} className={u.form}>
      <input type="hidden" name="ticket_id" value={ticketId} />
      <div className={u.field}><label htmlFor="reply">Reply</label><textarea className="input" id="reply" name="body" rows={4} required maxLength={5000} /></div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending…' : 'Send reply'}</button></div>
    </form>
  );
}

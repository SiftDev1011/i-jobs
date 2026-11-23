'use client';

import { useActionState, useRef } from 'react';
import { sendInvites } from '@/app/actions/owner';
import type { Result } from '@/lib/act';
import u from '../../_ui/ui.module.css';

type R = Result<{ queued: number; skipped: number; invalid: string[] }>;

export function InviteForm({ id, phone }: { id: string; phone: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [r, act, pending] = useActionState<R | null, FormData>(async (p, f) => {
    const out = await sendInvites(id, p, f);
    if (out.ok) form.current?.reset();
    return out;
  }, null);
  const d = r?.ok ? r.data : null;
  return (
    <form ref={form} action={act} className={u.form}>
      <div className={u.field}>
        <label htmlFor="targets">{phone ? 'Emails or phone numbers' : 'Email addresses'}</label>
        <textarea className="input" id="targets" name="targets" rows={6} required placeholder={phone ? 'ada@example.com\n0803 123 4567\n+254 712 345 678' : 'ada@example.com\nchidi@example.com'} />
        <span className={u.help}>{phone ? 'One per line, or separated by commas. Up to 500 at a time. Nigerian numbers can start with 0. We send each invite once, from i-jobs.' : 'One per line, or separated by commas. Up to 500 at a time. We email each invite once, from i-jobs.'}</span>
      </div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      {d && (
        <p className={`${u.notice} ${d.invalid.length ? '' : u.good}`} role="status">
          {d.queued} invite{d.queued === 1 ? '' : 's'} on the way.{d.skipped ? ` ${d.skipped} already invited.` : ''}
          {d.invalid.length > 0 && <> We couldn’t read: {d.invalid.slice(0, 8).join(', ')}{d.invalid.length > 8 ? '…' : ''}</>}
        </p>
      )}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending…' : 'Send invites'}</button></div>
    </form>
  );
}

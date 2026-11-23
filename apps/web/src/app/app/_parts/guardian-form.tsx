'use client';

import { useActionState } from 'react';
import { askGuardian, type Result } from '@/app/actions/member';
import u from '../_ui/ui.module.css';

export function GuardianForm() {
  const [r, act, pending] = useActionState<Result | null, FormData>(askGuardian, null);
  if (r?.ok) return <p className={`${u.notice} ${u.good}`}>We emailed them. Job features open as soon as they approve.</p>;
  return (
    <form action={act} className={u.form}>
      <div className={u.grid2}>
        <div className={u.field}><label htmlFor="g-name">Their name</label><input className="input" id="g-name" name="guardian_name" required /></div>
        <div className={u.field}><label htmlFor="g-email">Their email</label><input className="input" id="g-email" name="guardian_email" type="email" required /></div>
      </div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending…' : 'Send the request'}</button></div>
    </form>
  );
}

'use client';

import { useActionState, useState } from 'react';
import { sendCode, verifyCode, type FormState } from '@/app/actions/auth';
import s from './sign-in.module.css';

export function SignInForm({ next, phone }: { next: string; phone: boolean }) {
  const [sent, send, sending] = useActionState<FormState, FormData>(sendCode, null);
  const [checked, check, checking] = useActionState<FormState, FormData>(verifyCode, null);
  const [again, setAgain] = useState(false);
  const target = sent?.ok && !again ? sent.target : null;

  if (!target) {
    return (
      <form action={send} className={s.form} noValidate>
        <label className="field-label" htmlFor="target">{phone ? 'Email or phone number' : 'Email address'}</label>
        <input className="input" id="target" name="target" autoComplete="email" inputMode="email" placeholder={phone ? 'ada@example.com or 0803 123 4567' : 'ada@example.com'} required
          defaultValue={sent?.target ?? ''} aria-invalid={sent?.field === 'target'} aria-describedby={sent?.error ? 'target-err' : undefined} autoFocus />
        {sent?.error && <p className="err" id="target-err">{sent.error}</p>}
        <button className="btn btn-green btn-block" disabled={sending}>{sending ? 'Sending…' : 'Send my code'}</button>
        <p className="hint">By continuing you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy notice</a>.</p>
      </form>
    );
  }
  return (
    <form action={(f) => { setAgain(false); return check(f); }} className={s.form} noValidate>
      <p className={s.sentTo}>We sent a code to <b>{target}</b>.</p>
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="next" value={next} />
      <label className="field-label" htmlFor="code">6-digit code</label>
      <input className={`input ${s.code}`} id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="123456" required autoFocus
        aria-invalid={checked?.field === 'code'} aria-describedby={checked?.error ? 'code-err' : undefined} />
      {checked?.error && <p className="err" id="code-err">{checked.error}</p>}
      <button className="btn btn-green btn-block" disabled={checking}>{checking ? 'Checking…' : 'Log in'}</button>
      <button type="button" className={`btn btn-plain btn-sm ${s.back}`} onClick={() => setAgain(true)}>{phone ? 'Use a different email or number' : 'Use a different email'}</button>
    </form>
  );
}

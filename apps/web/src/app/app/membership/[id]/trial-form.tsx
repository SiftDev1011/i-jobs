'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { sendPhoneCode, startTrial } from '@/app/actions/member';
import u from '../../_ui/ui.module.css';

export function TrialForm({ membershipId, phone: saved }: { membershipId: string; phone: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState(saved);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () => start(async () => {
    setError(null);
    const r = await sendPhoneCode(phone);
    if (r.ok) setSentTo(r.data!.phone); else setError(r.error);
  });
  const go = () => start(async () => {
    setError(null);
    const r = await startTrial(membershipId, code.trim());
    if (r.ok) router.push('/app?trial=1'); else setError(r.error);
  });

  return (
    <div className={u.form}>
      {!sentTo ? (
        <>
          <div className={u.field}>
            <label htmlFor="phone">Your phone number</label>
            <input className="input" id="phone" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn btn-line btn-block" onClick={send} disabled={pending || !phone.trim()}>{pending ? 'Sending…' : 'Text me a code'}</button>
        </>
      ) : (
        <>
          <p className={u.muted}>We texted a code to <b>{sentTo}</b>.</p>
          <div className={u.field}>
            <label htmlFor="trial-code">6-digit code</label>
            <input className="input" id="trial-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          <button className="btn btn-green btn-block" onClick={go} disabled={pending || code.length !== 6}>{pending ? 'Starting…' : 'Start my free week'}</button>
          <button className="btn btn-plain btn-sm" onClick={() => setSentTo(null)}>Use another number</button>
        </>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

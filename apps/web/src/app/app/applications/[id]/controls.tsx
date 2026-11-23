'use client';

import { useState, useTransition } from 'react';
import { answerCheckin, cancelApplication } from '@/app/actions/member';
import { CHECKIN_ANSWERS } from '@/lib/labels';
import u from '../../_ui/ui.module.css';

export function CancelButton({ id }: { id: string }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!sure) return <button className="btn btn-line btn-sm" onClick={() => setSure(true)}>Cancel it</button>;
  return (
    <span className={u.row}>
      <button className="btn btn-green btn-sm" disabled={pending} onClick={() => start(async () => { const r = await cancelApplication(id); if (!r.ok) setError(r.error); })}>Yes, don&rsquo;t send</button>
      <button className="btn btn-plain btn-sm" onClick={() => setSure(false)}>Keep it</button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}

export function Checkin({ applicationId, checkinId, question }: { applicationId: string; checkinId: string; question: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <p className={`${u.notice} ${u.good}`}>Thanks. That helps us find you better jobs.</p>;
  return (
    <div className={u.card}>
      <h2 className={u.h2}>{question}</h2>
      <div className={u.checks}>
        {CHECKIN_ANSWERS.map(([k, l]) => (
          <button key={k} className="btn btn-line btn-sm" disabled={pending} onClick={() => start(async () => { const r = await answerCheckin(applicationId, checkinId, k); if (r.ok) setDone(true); })}>{l}</button>
        ))}
      </div>
    </div>
  );
}

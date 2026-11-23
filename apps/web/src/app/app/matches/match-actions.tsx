'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { setMatch } from '@/app/actions/member';
import s from './matches.module.css';

export function MatchActions({ jobId, status }: { jobId: string; status: string }) {
  const [now, setNow] = useState(status);
  const [pending, start] = useTransition();
  const set = (v: 'saved' | 'dismissed' | 'seen') => start(async () => { const r = await setMatch(jobId, v); if (r.ok) setNow(v); });
  if (now === 'dismissed') return <p className={s.gone}>Hidden. <button className={s.undo} onClick={() => set('seen')}>Undo</button></p>;
  return (
    <div className={s.actions}>
      <Link className="btn btn-green btn-sm" href={`/app/jobs/${jobId}`}>View and apply</Link>
      {now === 'saved' ? (
        <button className="btn btn-plain btn-sm" disabled={pending} onClick={() => set('seen')}>Saved ✓</button>
      ) : (
        <button className="btn btn-line btn-sm" disabled={pending} onClick={() => set('saved')}>Save</button>
      )}
      <button className="btn btn-plain btn-sm" disabled={pending} onClick={() => set('dismissed')}>Not for me</button>
    </div>
  );
}

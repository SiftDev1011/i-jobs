'use client';

import { useActionState, useState, useTransition } from 'react';
import { appealStrike, startDemoTour } from '@/app/actions/owner';
import type { Result } from '@/lib/act';
import { CopyField } from '../../_parts/copy-field';
import u from '../../_ui/ui.module.css';

export function DemoTour({ id, left }: { id: string; left: number }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result<{ url: string; left: number }> | null>(null);
  if (r?.ok && r.data) return (
    <div className={u.form}>
      <CopyField id="demo-link" label="Send this link. It works for 24 hours and shows sample data only." value={r.data.url} />
      <p className={u.muted}>{r.data.left === 1 ? '1 tour left.' : 'That was your last tour.'}</p>
    </div>
  );
  return (
    <div className={u.row}>
      <button type="button" className="btn btn-line btn-sm" disabled={pending || left < 1} onClick={() => start(async () => setR(await startDemoTour(id)))}>
        {pending ? 'Making a link…' : 'Make a tour link'}
      </button>
      <span className={u.muted}>{left > 0 ? `${left} of 2 left` : 'Both tours used'}</span>
      {r && !r.ok && <span className="err">{r.error}</span>}
    </div>
  );
}

export function AppealForm({ id, strikeId }: { id: string; strikeId: string }) {
  const [open, setOpen] = useState(false);
  const [r, act, pending] = useActionState<Result | null, FormData>(appealStrike.bind(null, id, strikeId), null);
  if (r?.ok) return <p className={`${u.notice} ${u.info}`}>Appeal sent. A person will look at it and you’ll see the decision here.</p>;
  if (!open) return <div><button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(true)}>Appeal</button></div>;
  return (
    <form action={act} className={u.form}>
      <div className={u.field}>
        <label htmlFor={`appeal-${strikeId}`}>Why should we take this strike back?</label>
        <textarea className="input" id={`appeal-${strikeId}`} name="reason" rows={3} minLength={10} maxLength={2000} required placeholder="For example: the company confirmed the job is real. Here is their careers page…" />
        <span className={u.help}>You can appeal each strike once.</span>
      </div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div className={u.row}>
        <button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending…' : 'Send appeal'}</button>
        <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

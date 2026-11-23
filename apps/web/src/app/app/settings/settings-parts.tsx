'use client';

import { useActionState, useState, useTransition } from 'react';
import { requestData, setConsent, updateMe, type Result } from '@/app/actions/member';
import type { components } from '@/lib/api-types';
import u from '../_ui/ui.module.css';

export function AccountForm({ name }: { name: string }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(updateMe, null);
  return (
    <form action={act} className={u.row} style={{ alignItems: 'flex-end' }}>
      <div className={u.field} style={{ flex: 1, minWidth: 220 }}><label htmlFor="full_name">Full name</label><input className="input" id="full_name" name="full_name" defaultValue={name} maxLength={120} /></div>
      <button className="btn btn-line" disabled={pending}>Save</button>
      {r && (r.ok ? <span className={u.muted}>Saved.</span> : <span className="err">{r.error}</span>)}
    </form>
  );
}

export function ConsentToggle({ purpose, title, text, granted }: { purpose: string; title: string; text: string; granted: boolean }) {
  const [on, setOn] = useState(granted);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className={u.toggle}>
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => {
        const next = e.target.checked;
        setOn(next);
        start(async () => { const r = await setConsent(purpose as components['schemas']['ConsentPurpose'], next); if (!r.ok) { setOn(!next); setError(r.error); } });
      }} />
      <span><b>{title}</b><span>{text}</span>{error && <span className="err">{error}</span>}</span>
    </label>
  );
}

export function DataRequestForm() {
  const [type, setType] = useState('export');
  const [r, act, pending] = useActionState<Result | null, FormData>(requestData, null);
  if (r?.ok) return <p className={`${u.notice} ${u.good}`}>{type === 'delete' ? 'Your account will be deleted in 48 hours. We emailed you; contact support before then to stop it.' : type === 'export' ? 'We’ll email you a download link, usually within minutes.' : 'A person will look at it and reply on a support ticket.'}</p>;
  return (
    <form action={act} className={u.form}>
      <div className={u.field}>
        <label htmlFor="dr-type">I want to</label>
        <select className="input" id="dr-type" name="type" value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 360 }}>
          <option value="export">Get a copy of my data</option>
          <option value="correct">Correct something</option>
          <option value="human_review">Ask a person to review a decision</option>
          <option value="delete">Delete my account</option>
        </select>
      </div>
      {(type === 'correct' || type === 'human_review') && <div className={u.field}><label htmlFor="dr-details">Tell us what</label><textarea className="input" id="dr-details" name="details" rows={3} required maxLength={2000} /></div>}
      {type === 'delete' && (
        <div className={u.field}>
          <p className={`${u.notice} ${u.bad}`}>This deletes your profile, CV, matches and applications after 48 hours. Payment records stay because the law requires it. Type DELETE to confirm.</p>
          <input className="input" name="confirm" autoComplete="off" style={{ maxWidth: 200 }} aria-label="Type DELETE to confirm" />
        </div>
      )}
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div><button className={`btn ${type === 'delete' ? 'btn-line' : 'btn-green'} btn-sm`} disabled={pending}>{pending ? 'Sending…' : 'Send request'}</button></div>
    </form>
  );
}

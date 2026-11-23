'use client';

import { useActionState } from 'react';
import { updateSource } from '@/app/actions/admin';
import type { Result } from '@/lib/act';
import type { components } from '@/lib/api-types';
import u from '../../_ui/ui.module.css';

type Source = components['schemas']['Source'];
const FLAGS: [keyof Source, string][] = [
  ['enabled', 'Fetch from this source'], ['allow_autopilot', 'Autopilot may apply'], ['apply_via_source_link', 'Apply through the source’s link'],
  ['allow_paywall', 'May sit behind membership'], ['allow_signup_gate', 'May ask visitors to sign up'], ['requires_credit', 'Must credit the source'],
];

export function SourceForm({ s, canEdit }: { s: Source; canEdit: boolean }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(updateSource.bind(null, s.key!), null);
  return (
    <form action={act} className={u.form}>
      <fieldset disabled={!canEdit} className={u.form} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className={u.grid3}>
          <div className={u.field}><label>Show jobs<select className="input" name="display" defaultValue={s.display} style={{ marginTop: 6 }}><option value="full">Everywhere</option><option value="job_finds_only">Job finds page only</option><option value="disabled">Nowhere</option></select></label></div>
          <div className={u.field}><label>Terms<select className="input" name="terms_status" defaultValue={s.terms_status} style={{ marginTop: 6 }}><option value="ok">OK</option><option value="needs_review">Needs review</option><option value="pending_reply">Waiting for their reply</option><option value="restricted">Restricted</option><option value="blocked">Blocked</option></select></label></div>
          <div className={u.field}><label>Fetch every (minutes)<input className="input" name="fetch_interval_minutes" type="number" min={5} max={10080} defaultValue={s.fetch_interval_minutes} style={{ marginTop: 6 }} /></label></div>
        </div>
        <div className={u.checks}>
          {FLAGS.map(([k, label]) => <label key={k} className={u.check}><input type="checkbox" name={k} defaultChecked={!!s[k]} /> {label}</label>)}
        </div>
        <div className={u.grid2}>
          <div className={u.field}><label>Credit line<input className="input" name="credit_text" maxLength={80} defaultValue={s.credit_text ?? ''} style={{ marginTop: 6 }} /></label></div>
          <div className={u.field}><label>Most fetches a day<input className="input" name="max_fetches_per_day" type="number" min={1} defaultValue={s.max_fetches_per_day ?? ''} style={{ marginTop: 6 }} /></label></div>
        </div>
        <div className={u.field}><label>Notes<textarea className="input" name="notes" rows={2} maxLength={2000} defaultValue={s.notes ?? ''} style={{ marginTop: 6 }} /></label></div>
        {canEdit && <div className={u.row}><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>{r && (r.ok ? <span className="muted-sm">Saved. The change is in the audit log.</span> : <span className="err" style={{ marginTop: 0 }}>{r.error}</span>)}</div>}
      </fieldset>
    </form>
  );
}

'use client';

import { useActionState, useRef } from 'react';
import { banCommunity, decideItem, takedownJob, verifyCommunity } from '@/app/actions/admin';
import type { Result } from '@/lib/act';
import u from '../../_ui/ui.module.css';

type Choice = { value: string; label: string; tone?: 'green' | 'line' };

/** One note box and several decision buttons; the clicked button's value is sent as `decision`. */
function Choices({ action, choices, strike, noteLabel, done }: {
  action: (p: Result | null, f: FormData) => Promise<Result>; choices: Choice[]; strike?: boolean; noteLabel: string; done: string;
}) {
  const decision = useRef<HTMLInputElement>(null);
  const [r, act, pending] = useActionState<Result | null, FormData>(action, null);
  if (r?.ok) return <p className={`${u.notice} ${u.good}`} role="status">{done}</p>;
  return (
    <form action={act} className={u.form}>
      <input type="hidden" name="decision" ref={decision} />
      <div className={u.field}><label>{noteLabel}<textarea className="input" name="note" rows={2} maxLength={2000} style={{ marginTop: 6 }} /></label></div>
      {strike && <label className={u.check} style={{ alignSelf: 'flex-start' }}><input type="checkbox" name="strike" /> Also give the posting community a strike</label>}
      {r && !r.ok && <p className="err" role="alert">{r.error}</p>}
      <div className={u.row}>
        {choices.map((c) => (
          <button key={c.value} className={`btn ${c.tone === 'green' ? 'btn-green' : 'btn-line'} btn-sm`} disabled={pending} onClick={() => { if (decision.current) decision.current.value = c.value; }}>{c.label}</button>
        ))}
      </div>
    </form>
  );
}

export function JobDecision({ itemId }: { itemId: string }) {
  return <Choices action={decideItem.bind(null, itemId)} strike noteLabel="Note (staff only)" done="Decided."
    choices={[{ value: 'approve', label: 'Approve', tone: 'green' }, { value: 'reject', label: 'Remove' }, { value: 'reject_as_scam', label: 'Remove as scam' }, { value: 'escalate', label: 'Escalate' }]} />;
}

export function GenericDecision({ itemId, approve = 'Approve', reject = 'Reject' }: { itemId: string; approve?: string; reject?: string }) {
  return <Choices action={decideItem.bind(null, itemId)} noteLabel="Note (staff only)" done="Decided."
    choices={[{ value: 'approve', label: approve, tone: 'green' }, { value: 'reject', label: reject }, { value: 'escalate', label: 'Escalate' }]} />;
}

export function CommunityVerify({ communityId }: { communityId: string }) {
  return <Choices action={verifyCommunity.bind(null, communityId)} noteLabel="Note for the owner (emailed to them; needed unless approving)" done="Decided. The owner has been emailed."
    choices={[{ value: 'approved', label: 'Approve community', tone: 'green' }, { value: 'needs_more_info', label: 'Ask for more' }, { value: 'rejected', label: 'Reject' }]} />;
}

export function BanForm({ communityId }: { communityId: string }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(banCommunity.bind(null, communityId), null);
  if (r?.ok) return <p className={`${u.notice} ${u.bad}`} role="status">Banned. Unused codes are void and payouts frozen; members keep access until their period ends.</p>;
  return (
    <form action={act} className={u.form}>
      <div className={u.field}><label>Why (kept in the audit log)<textarea className="input" name="reason" rows={2} required minLength={5} maxLength={2000} style={{ marginTop: 6 }} /></label></div>
      <div className={u.row} style={{ alignItems: 'flex-end' }}>
        <div className={u.field}><label>Type BAN to confirm<input className="input" name="confirm" autoComplete="off" style={{ width: 120, marginTop: 6 }} /></label></div>
        <button className="btn btn-line btn-sm" disabled={pending}>{pending ? 'Banning…' : 'Ban community and owner'}</button>
      </div>
      {r && !r.ok && <p className="err" role="alert">{r.error}</p>}
    </form>
  );
}

export function TakedownForm() {
  const [r, act, pending] = useActionState<Result | null, FormData>(takedownJob, null);
  return (
    <form action={act} className={u.form}>
      <div className={u.row} style={{ alignItems: 'flex-end' }}>
        <div className={u.field} style={{ flex: 1, minWidth: 240 }}><label htmlFor="td-job">Job link or id</label><input className="input" id="td-job" name="job" required placeholder="https://…/jobs/3f2a…" /></div>
        <div className={u.field}>
          <label htmlFor="td-reason">Reason</label>
          <select className="input" id="td-reason" name="reason" defaultValue="scam" style={{ width: 160 }}>
            <option value="scam">Scam</option><option value="closed">Closed</option><option value="terms">Breaks terms</option><option value="duplicate">Duplicate</option><option value="other">Other</option>
          </select>
        </div>
        <button className="btn btn-line btn-sm" disabled={pending}>{pending ? 'Taking down…' : 'Take down'}</button>
      </div>
      {r && (r.ok ? <p className={`${u.notice} ${u.good}`} role="status">Taken down.</p> : <p className="err" role="alert">{r.error}</p>)}
    </form>
  );
}

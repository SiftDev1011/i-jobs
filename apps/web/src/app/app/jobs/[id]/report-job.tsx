'use client';

import { useActionState, useState } from 'react';
import { reportJob, type Result } from '@/app/actions/member';
import u from '../../_ui/ui.module.css';

const REASONS: [string, string][] = [['asks_for_money', 'They ask for money or a fee'], ['scam', 'Looks like a scam'], ['wrong_details', 'Details are wrong'], ['closed', 'The job has closed'], ['offensive', 'Offensive'], ['other', 'Something else']];

export function ReportJob({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [r, act, pending] = useActionState<Result | null, FormData>(reportJob, null);
  if (r?.ok) return <p className={`${u.notice} ${u.good}`}>Thanks. A moderator will look at it.</p>;
  if (!open) return <button className="btn btn-plain btn-sm" style={{ alignSelf: 'flex-start', color: 'var(--mute)' }} onClick={() => setOpen(true)}>Report this job</button>;
  return (
    <form action={act} className={`${u.card} ${u.form}`}>
      <input type="hidden" name="job_id" value={jobId} />
      <h2 className={u.h2}>Report this job</h2>
      <div className={u.field}><label htmlFor="reason">What&rsquo;s wrong?</label>
        <select className="input" id="reason" name="reason" required defaultValue="">{[['', 'Choose one'], ...REASONS].map(([k, l]) => <option key={k} value={k} disabled={!k}>{l}</option>)}</select>
      </div>
      <div className={u.field}><label htmlFor="details">Anything else (optional)</label><textarea className="input" id="details" name="details" rows={3} maxLength={1000} /></div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div className={u.row}><button className="btn btn-green btn-sm" disabled={pending}>Send report</button><button type="button" className="btn btn-plain btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

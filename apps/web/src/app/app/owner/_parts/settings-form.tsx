'use client';

import { useActionState } from 'react';
import { updateCommunity } from '@/app/actions/owner';
import type { Result } from '@/lib/act';
import u from '../../_ui/ui.module.css';

type C = { description?: string | null; priceNaira: number; minNaira: number; period: string; trial: boolean; approval: boolean; share: number; freeWeeks: boolean };

export function SettingsForm({ id, c }: { id: string; c: C }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(updateCommunity.bind(null, id), null);
  return (
    <form action={act} className={u.form}>
      <div className={u.field}>
        <label htmlFor="description">About your community</label>
        <textarea className="input" id="description" name="description" rows={4} maxLength={1000} defaultValue={c.description ?? ''} placeholder="Who it’s for and what kind of jobs you share." />
        <span className={u.help}>Shown on your join page and when people search for communities.</span>
      </div>
      <div className={u.row} style={{ alignItems: 'flex-end' }}>
        <div className={u.field}>
          <label htmlFor="price">Price (₦)</label>
          <input className="input" id="price" name="price" inputMode="numeric" defaultValue={c.priceNaira.toLocaleString('en-NG')} required style={{ width: 160 }} />
        </div>
        <div className={u.field}>
          <label htmlFor="billing_period">Charged</label>
          <select className="input" id="billing_period" name="billing_period" defaultValue={c.period} style={{ width: 180 }}>
            <option value="monthly">Every month</option><option value="quarterly">Every 3 months</option><option value="yearly">Every year</option>
          </select>
        </div>
      </div>
      <p className={u.help}>At least ₦{c.minNaira.toLocaleString('en-NG')}. You keep {100 - c.share}%. A new price applies from each member’s next payment.</p>
      {c.freeWeeks && <label className={u.toggle}>
        <input type="checkbox" name="trial_enabled" defaultChecked={c.trial} />
        <span><b>Free week</b><span>New members can try i-jobs for 7 days after confirming their phone number.</span></span>
      </label>}
      <label className={u.toggle}>
        <input type="checkbox" name="approval_required" defaultChecked={c.approval} />
        <span><b>I approve who joins</b><span>People who find your community wait for you to let them in.</span></span>
      </label>
      {r && (r.ok ? <p className={`${u.notice} ${u.good}`} role="status">Saved.</p> : <p className="err">{r.error}</p>)}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  );
}

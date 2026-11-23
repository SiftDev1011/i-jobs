'use client';

import { useActionState, useState } from 'react';
import { saveAutopilot, type Result } from '@/app/actions/member';
import type { components } from '@/lib/api-types';
import u from '../_ui/ui.module.css';

type Rules = components['schemas']['AutopilotRules'];
const REGIONS: [string, string][] = [['worldwide', 'Worldwide'], ['africa', 'Africa'], ['NG', 'Nigeria'], ['emea', 'Europe, Middle East & Africa']];
const TYPES: [string, string][] = [['full_time', 'Full time'], ['part_time', 'Part time'], ['contract', 'Contract'], ['freelance', 'Freelance'], ['internship', 'Internship'], ['graduate', 'Graduate']];

export function AutopilotForm({ rules, consented }: { rules: Rules; consented: boolean }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(saveAutopilot, null);
  const [on, setOn] = useState(!!rules.enabled);
  const [match, setMatch] = useState(rules.min_match ?? 70);
  const [cap, setCap] = useState(rules.daily_cap ?? 10);
  const paused = rules.paused_until && new Date(rules.paused_until) > new Date() ? rules.paused_until.slice(0, 10) : '';
  const regions = new Set(rules.regions ?? ['worldwide']);
  const types = new Set(rules.employment_types ?? []);

  return (
    <form action={act} className={u.form}>
      <section className={u.card}>
        <label className={u.toggle}>
          <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span><b>Autopilot is {on ? 'on' : 'off'}</b><span>{on ? 'Strong matches inside your rules are sent for you.' : 'Matches wait in your apply queue for you to send.'}</span></span>
        </label>
        {on && !consented && (
          <label className={u.toggle}>
            <input type="checkbox" name="consent" required />
            <span><b>Send applications in my name</b><span>I agree that i-jobs sends applications for me from my i-jobs address, using my profile and CV.</span></span>
          </label>
        )}
      </section>

      <section className={u.card}>
        <h2 className={u.h2}>Which jobs</h2>
        <div className={u.field}>
          <label htmlFor="min_match">Only jobs that match at least <b>{match}%</b></label>
          <input id="min_match" name="min_match" type="range" min={50} max={95} step={5} value={match} onChange={(e) => setMatch(Number(e.target.value))} style={{ accentColor: 'var(--action)' }} />
          <span className={u.help}>Higher means fewer, closer matches.</span>
        </div>
        <div className={u.field}>
          <span className={u.legend}>Open to people in</span>
          <div className={u.checks}>{REGIONS.map(([k, l]) => <label key={k} className={u.check}><input type="checkbox" name="regions" value={k} defaultChecked={regions.has(k)} />{l}</label>)}</div>
        </div>
        <label className={u.toggle}><input type="checkbox" name="include_unspecified" defaultChecked={rules.include_unspecified} /><span><b>Include jobs that don&rsquo;t say where</b><span>Many remote jobs don&rsquo;t list countries. Some will turn out not to be open to you.</span></span></label>
        <div className={u.field}>
          <span className={u.legend}>Kinds of work</span>
          <div className={u.checks}>{TYPES.map(([k, l]) => <label key={k} className={u.check}><input type="checkbox" name="employment_types" value={k} defaultChecked={types.has(k as never)} />{l}</label>)}</div>
          <span className={u.help}>Leave all empty for any kind.</span>
        </div>
        <div className={u.grid2}>
          <div className={u.field}>
            <label htmlFor="min_pay">Lowest pay a month</label>
            <input className="input" id="min_pay" name="min_pay" type="number" min={0} step={1000} defaultValue={rules.min_pay_monthly ? rules.min_pay_monthly.amount_minor / 100 : ''} placeholder="150000" />
          </div>
          <div className={u.field}>
            <label htmlFor="currency">Currency</label>
            <select className="input" id="currency" name="currency" defaultValue={rules.min_pay_monthly?.currency ?? 'NGN'}><option value="NGN">Naira (₦)</option><option value="USD">US dollars ($)</option></select>
          </div>
        </div>
        <span className={u.help}>Jobs that don&rsquo;t say what they pay still count.</span>
      </section>

      <section className={u.card}>
        <h2 className={u.h2}>How much</h2>
        <div className={u.field}>
          <label htmlFor="daily_cap">Up to <b>{cap}</b> applications a day</label>
          <input id="daily_cap" name="daily_cap" type="range" min={1} max={25} value={cap} onChange={(e) => setCap(Number(e.target.value))} style={{ accentColor: 'var(--action)' }} />
        </div>
        <div className={u.field}>
          <label htmlFor="paused_until">Pause until (optional)</label>
          <input className="input" id="paused_until" name="paused_until" type="date" defaultValue={paused} style={{ maxWidth: 220 }} />
          <span className={u.help}>Going on holiday or started a job? Nothing is sent until this date.</span>
        </div>
      </section>

      <div className={u.row}>
        <button className="btn btn-green" disabled={pending}>{pending ? 'Saving…' : 'Save rules'}</button>
        {r && (r.ok ? <span className={u.muted}>Saved.</span> : <span className="err">{r.error}</span>)}
      </div>
    </form>
  );
}

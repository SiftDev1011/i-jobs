'use client';

import { useActionState, useState } from 'react';
import { postEmployerJob } from '@/app/actions/employer';
import type { Result } from '@/lib/act';
import u from '../../_ui/ui.module.css';

export function JobForm({ employerId, domain, myEmail }: { employerId: string; domain: string; myEmail: string | null }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(postEmployerJob.bind(null, employerId), null);
  const [scope, setScope] = useState('worldwide');
  const [how, setHow] = useState('email');
  const err = (f: string) => (r && !r.ok && r.field === f ? <span className="err">{r.error}</span> : null);
  const today = new Date().toISOString().slice(0, 10);
  const onDomain = myEmail && domain && myEmail.toLowerCase().endsWith(`@${domain.toLowerCase()}`) ? myEmail : '';

  return (
    <form action={act} className={u.form}>
      <div className={u.field}><label htmlFor="title">Job title</label><input className="input" id="title" name="title" required minLength={3} maxLength={200} placeholder="Customer Support Lead" />{err('title')}</div>
      <div className={u.field}>
        <label htmlFor="description">Description</label>
        <textarea className="input" id="description" name="description" rows={12} required minLength={100} maxLength={20000} placeholder={'What the job is, what you need, and what you offer.\n\nBullet points are fine.'} />
        <span className={u.help}>At least 100 characters. Never ask applicants for money, BVN or bank details — those posts are removed.</span>{err('description')}
      </div>
      <div className={u.grid2}>
        <div className={u.field}>
          <label htmlFor="employment_type">Type</label>
          <select className="input" id="employment_type" name="employment_type" defaultValue="full_time">
            <option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="freelance">Freelance</option>
            <option value="internship">Internship</option><option value="graduate">Graduate</option><option value="temporary">Temporary</option>
          </select>
        </div>
        <div className={u.field}>
          <label htmlFor="location_scope">Who can apply</label>
          <select className="input" id="location_scope" name="location_scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="worldwide">Anyone, anywhere (remote)</option><option value="restricted">Only some countries</option>
          </select>
        </div>
      </div>
      {scope === 'restricted' && <div className={u.field}><label htmlFor="allowed_countries">Countries</label><input className="input" id="allowed_countries" name="allowed_countries" required placeholder="NG, GH, KE" /><span className={u.help}>Two-letter codes, separated by commas.</span>{err('allowed_countries')}</div>}

      <fieldset className={u.form} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={u.legend}>Pay (optional, but jobs with pay get more good applicants)</legend>
        <div className={u.row} style={{ alignItems: 'flex-end' }}>
          <div className={u.field}><label htmlFor="pay_currency" className="sr-only">Currency</label>
            <select className="input" id="pay_currency" name="pay_currency" defaultValue="NGN" style={{ width: 100 }}>{['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className={u.field}><label htmlFor="pay_min">From</label><input className="input" id="pay_min" name="pay_min" inputMode="decimal" style={{ width: 140 }} /></div>
          <div className={u.field}><label htmlFor="pay_max">To</label><input className="input" id="pay_max" name="pay_max" inputMode="decimal" style={{ width: 140 }} /></div>
          <div className={u.field}><label htmlFor="pay_period">Per</label>
            <select className="input" id="pay_period" name="pay_period" defaultValue="month" style={{ width: 130 }}><option value="hour">hour</option><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option><option value="project">project</option></select></div>
        </div>
        {err('pay_currency')}
      </fieldset>

      <div className={u.field}><label htmlFor="skills">Skills</label><input className="input" id="skills" name="skills" placeholder="Zendesk, written English, SQL" /><span className={u.help}>Up to 15, separated by commas. They help us match the right people.</span></div>

      <fieldset className={u.form} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={u.legend}>How people apply</legend>
        <label className={u.toggle}><input type="radio" name="apply_how" value="email" checked={how === 'email'} onChange={() => setHow('email')} style={{ width: 18, height: 18 }} /><span><b>Through i-jobs, by email</b><span>Each application arrives as an email with the CV attached. Replies go back to the applicant.</span></span></label>
        {how === 'email' && <div className={u.field} style={{ paddingLeft: 52 }}><label htmlFor="apply_email">Send applications to</label><input className="input" id="apply_email" name="apply_email" type="email" defaultValue={onDomain} placeholder={`jobs@${domain}`} required={!onDomain} /><span className={u.help}>An address on {domain}.</span></div>}
        <label className={u.toggle}><input type="radio" name="apply_how" value="link" checked={how === 'link'} onChange={() => setHow('link')} style={{ width: 18, height: 18 }} /><span><b>On our careers page</b><span>We send people to your link. Autopilot can’t apply there for them.</span></span></label>
        {how === 'link' && <div className={u.field} style={{ paddingLeft: 52 }}><label htmlFor="apply_url">Link</label><input className="input" id="apply_url" name="apply_url" required placeholder={`https://${domain}/careers/…`} />{err('apply_url')}</div>}
      </fieldset>

      <div className={u.grid2}>
        <div className={u.field}><label htmlFor="deadline">Closing date (optional)</label><input className="input" id="deadline" name="deadline" type="date" min={today} /></div>
        <div className={u.field}><label htmlFor="max_applicants">Close after this many applicants (optional)</label><input className="input" id="max_applicants" name="max_applicants" type="number" min={1} max={10000} /></div>
      </div>
      {r && !r.ok && !['title', 'description', 'allowed_countries', 'pay_currency', 'apply_url'].includes(r.field ?? '') && <p className="err" role="alert">{r.error}</p>}
      <div><button className="btn btn-green" disabled={pending}>{pending ? 'Posting…' : 'Post job'}</button></div>
    </form>
  );
}

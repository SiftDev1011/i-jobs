'use client';

import { useActionState, useState } from 'react';
import { saveProfile, type Result } from '@/app/actions/member';
import type { components } from '@/lib/api-types';
import u from '../_ui/ui.module.css';
import s from './profile.module.css';

type Profile = components['schemas']['Profile'];
type Job = NonNullable<Profile['experience']>[number];
type School = NonNullable<Profile['education']>[number];

/** Edit everything the CV reader found. Experience and education are lists you can add to. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(saveProfile, null);
  const [jobs, setJobs] = useState<Job[]>(profile.experience ?? []);
  const [schools, setSchools] = useState<School[]>(profile.education ?? []);

  const setJob = (i: number, patch: Partial<Job>) => setJobs((all) => all.map((j, k) => (k === i ? { ...j, ...patch } : j)));
  const setSchool = (i: number, patch: Partial<School>) => setSchools((all) => all.map((j, k) => (k === i ? { ...j, ...patch } : j)));

  return (
    <form action={act} className={u.form}>
      <input type="hidden" name="experience" value={JSON.stringify(jobs.filter((j) => j.title || j.company))} />
      <input type="hidden" name="education" value={JSON.stringify(schools.filter((e) => e.school || e.qualification))} />

      <section className={u.card}>
        <h2 className={u.h2}>About you</h2>
        <div className={u.field}><label htmlFor="headline">Headline</label><input className="input" id="headline" name="headline" maxLength={120} defaultValue={profile.headline ?? ''} placeholder="Customer support specialist, 3 years in fintech" /></div>
        <div className={u.field}><label htmlFor="summary">Summary</label><textarea className="input" id="summary" name="summary" rows={4} maxLength={1500} defaultValue={profile.summary ?? ''} /></div>
        <div className={u.grid3}>
          <div className={u.field}><label htmlFor="years">Years of experience</label><input className="input" id="years" name="years_experience" type="number" min={0} max={50} defaultValue={profile.years_experience ?? ''} /></div>
          <div className={u.field}><label htmlFor="city">City</label><input className="input" id="city" name="city" defaultValue={profile.city ?? ''} placeholder="Lagos" /></div>
          <div className={u.field}><label htmlFor="country">Country (2 letters)</label><input className="input" id="country" name="country" maxLength={2} defaultValue={profile.country ?? ''} placeholder="NG" /></div>
        </div>
      </section>

      <section className={u.card}>
        <h2 className={u.h2}>Skills and languages</h2>
        <div className={u.field}><label htmlFor="skills">Skills</label><textarea className="input" id="skills" name="skills" rows={2} defaultValue={(profile.skills ?? []).join(', ')} /><span className={u.help}>Separate with commas. Name tools too: Excel, Zendesk, Figma.</span></div>
        <div className={u.field}><label htmlFor="languages">Languages</label><input className="input" id="languages" name="languages" defaultValue={(profile.languages ?? []).join(', ')} placeholder="English, Yoruba" /></div>
        <div className={u.field}><label htmlFor="links">Links</label><input className="input" id="links" name="links" defaultValue={(profile.links ?? []).join(', ')} placeholder="https://linkedin.com/in/…, portfolio" /></div>
      </section>

      <section className={u.card}>
        <h2 className={u.h2}>Where you can work</h2>
        <label className={u.toggle}><input type="checkbox" name="remote_any_country" defaultChecked={!!profile.work_authorization?.remote_any_country} /><span><b>I can work remotely for a company in any country</b><span>Most remote jobs ask this. Turn it off if you can only work for companies in certain countries.</span></span></label>
        <div className={u.field}><label htmlFor="auth">Countries you can work in (2-letter codes)</label><input className="input" id="auth" name="auth_countries" defaultValue={(profile.work_authorization?.countries ?? []).join(', ')} placeholder="NG, GH" /></div>
      </section>

      <section className={u.card}>
        <div className={`${u.row} ${u.between}`}><h2 className={u.h2}>Experience</h2><button type="button" className="btn btn-plain btn-sm" onClick={() => setJobs((a) => [{ title: '', company: '', start: '', end: null, highlights: [] }, ...a])}>Add a job</button></div>
        {jobs.length === 0 && <p className={u.muted}>No jobs yet. Add your most recent one.</p>}
        {jobs.map((j, i) => (
          <fieldset key={i} className={s.item}>
            <div className={u.grid2}>
              <div className={u.field}><label>Job title</label><input className="input" value={j.title ?? ''} onChange={(e) => setJob(i, { title: e.target.value })} /></div>
              <div className={u.field}><label>Company</label><input className="input" value={j.company ?? ''} onChange={(e) => setJob(i, { company: e.target.value })} /></div>
              <div className={u.field}><label>Started (YYYY-MM)</label><input className="input" value={j.start ?? ''} placeholder="2023-04" onChange={(e) => setJob(i, { start: e.target.value })} /></div>
              <div className={u.field}><label>Ended (blank if current)</label><input className="input" value={j.end ?? ''} placeholder="2025-01" onChange={(e) => setJob(i, { end: e.target.value || null })} /></div>
            </div>
            <div className={u.field}><label>What you did (one per line)</label><textarea className="input" rows={3} value={(j.highlights ?? []).join('\n')} onChange={(e) => setJob(i, { highlights: e.target.value.split('\n') })} /></div>
            <button type="button" className={`btn btn-plain btn-sm ${s.remove}`} onClick={() => setJobs((a) => a.filter((_, k) => k !== i))}>Remove</button>
          </fieldset>
        ))}
      </section>

      <section className={u.card}>
        <div className={`${u.row} ${u.between}`}><h2 className={u.h2}>Education</h2><button type="button" className="btn btn-plain btn-sm" onClick={() => setSchools((a) => [...a, { school: '', qualification: '' }])}>Add</button></div>
        {schools.map((e, i) => (
          <fieldset key={i} className={s.item}>
            <div className={u.grid3}>
              <div className={u.field}><label>School</label><input className="input" value={e.school ?? ''} onChange={(ev) => setSchool(i, { school: ev.target.value })} /></div>
              <div className={u.field}><label>Qualification</label><input className="input" value={e.qualification ?? ''} placeholder="BSc Economics" onChange={(ev) => setSchool(i, { qualification: ev.target.value })} /></div>
              <div className={u.field}><label>Year</label><input className="input" type="number" value={e.year ?? ''} onChange={(ev) => setSchool(i, { year: ev.target.value ? Number(ev.target.value) : undefined })} /></div>
            </div>
            <button type="button" className={`btn btn-plain btn-sm ${s.remove}`} onClick={() => setSchools((a) => a.filter((_, k) => k !== i))}>Remove</button>
          </fieldset>
        ))}
      </section>

      <div className={s.save}>
        {r && (r.ok ? <span className={u.muted}>Saved.</span> : <span className="err">{r.error}</span>)}
        <button className="btn btn-green" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}

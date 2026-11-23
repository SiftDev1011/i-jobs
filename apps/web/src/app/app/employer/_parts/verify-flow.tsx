'use client';

import { useActionState, useState } from 'react';
import { confirmEmployerCheck, startEmployerCheck } from '@/app/actions/employer';
import type { Result } from '@/lib/act';
import u from '../../_ui/ui.module.css';

/** Step 1: company and work email. Step 2: the 6-digit code we email to that address. */
export function VerifyFlow() {
  const [email, setEmail] = useState<string | null>(null);
  const [r, act, pending] = useActionState<Result<{ email: string }> | null, FormData>(async (p, f) => {
    const out = await startEmployerCheck(p, f);
    if (out.ok && out.data) setEmail(out.data.email);
    return out;
  }, null);
  if (email) return <ConfirmStep email={email} back={() => setEmail(null)} />;
  return (
    <form action={act} className={u.form}>
      <div className={u.grid2}>
        <div className={u.field}><label htmlFor="company_name">Company name</label><input className="input" id="company_name" name="company_name" required minLength={2} maxLength={160} autoComplete="organization" /></div>
        <div className={u.field}><label htmlFor="website_url">Company website</label><input className="input" id="website_url" name="website_url" required placeholder="acme.com" autoComplete="url" /></div>
      </div>
      <div className={u.field}>
        <label htmlFor="work_email">Your work email</label>
        <input className="input" id="work_email" name="work_email" type="email" required autoComplete="email" placeholder="you@acme.com" />
        <span className={u.help}>It must be on your website’s domain. Gmail, Yahoo and other free addresses can’t be used.</span>
      </div>
      <div className={u.grid2}>
        <div className={u.field}><label htmlFor="registry_number">Company registration number</label><input className="input" id="registry_number" name="registry_number" maxLength={40} placeholder="RC 1234567" /><span className={u.help}>CAC RC number in Nigeria. A person checks it.</span></div>
        <div className={u.field}>
          <label htmlFor="country">Registered in</label>
          <select className="input" id="country" name="country" defaultValue="NG">
            <option value="NG">Nigeria</option><option value="GH">Ghana</option><option value="KE">Kenya</option><option value="ZA">South Africa</option>
            <option value="GB">United Kingdom</option><option value="US">United States</option><option value="">Somewhere else</option>
          </select>
        </div>
      </div>
      {r && !r.ok && <p className="err" role="alert">{r.error}</p>}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending code…' : 'Email me a code'}</button></div>
    </form>
  );
}

function ConfirmStep({ email, back }: { email: string; back: () => void }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(confirmEmployerCheck.bind(null, email), null);
  return (
    <form action={act} className={u.form}>
      <p>We sent a 6-digit code to <b>{email}</b>. It works for 15 minutes.</p>
      <div className={u.field}>
        <label htmlFor="code">Code</label>
        <input className="input" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required style={{ width: 160, letterSpacing: '0.2em' }} autoFocus />
      </div>
      {r && !r.ok && <p className="err" role="alert">{r.error}</p>}
      <div className={u.row}>
        <button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Checking…' : 'Confirm'}</button>
        <button type="button" className="btn btn-line btn-sm" onClick={back}>Use a different email</button>
      </div>
    </form>
  );
}

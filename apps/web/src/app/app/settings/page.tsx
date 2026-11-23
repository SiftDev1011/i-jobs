import type { Metadata } from 'next';
import { currentUser, engine, must } from '@/lib/engine';
import { CONSENTS } from '@/lib/labels';
import u from '../_ui/ui.module.css';
import { AccountForm, ConsentToggle, DataRequestForm } from './settings-parts';

export const metadata: Metadata = { title: 'Settings & privacy' };
const DR_TYPE = { export: 'Copy of my data', delete: 'Delete my account', correct: 'Correct my data', human_review: 'Human review of a decision' } as const;
const DR_STATUS = { received: 'Received', in_progress: 'In progress', done: 'Done', refused: 'Closed' } as const;

export default async function Settings() {
  const me = (await currentUser())!;
  const api = await engine();
  const [consents, requests] = await Promise.all([api.GET('/me/consents').then(must), api.GET('/me/data-requests').then(must)]);
  const current = new Map(consents.map((c) => [c.purpose, c.granted]));

  return (
    <main className={u.page}>
      <h1 className={u.h1}>Settings &amp; privacy</h1>

      <section className={u.section}>
        <h2 className={u.h2}>Your account</h2>
        <div className={u.card}>
          <AccountForm name={me.full_name ?? ''} />
          <dl className={u.muted} style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            {me.email && <><dt>Email</dt><dd style={{ margin: 0 }}>{me.email}</dd></>}
            {me.phone && <><dt>Phone</dt><dd style={{ margin: 0 }}>{me.phone}</dd></>}
            {me.relay_address && <><dt>Your i-jobs address</dt><dd style={{ margin: 0 }}>{me.relay_address}</dd></>}
          </dl>
          {me.relay_address && <p className={u.help}>Applications go out from your i-jobs address and replies come back to it, then on to your email. Employers never see your personal email until you reply yourself.</p>}
        </div>
      </section>

      <section className={u.section}>
        <h2 className={u.h2}>What i-jobs may do</h2>
        <div className={u.card}>
          {CONSENTS.map((c) => <ConsentToggle key={c.purpose} purpose={c.purpose} title={c.title} text={c.text} granted={!!current.get(c.purpose as never)} />)}
          <p className={u.help}>Each change is recorded with the date. Turning off &ldquo;Send applications in my name&rdquo; stops autopilot at once and cancels anything still waiting to go.</p>
        </div>
      </section>

      <section className={u.section}>
        <h2 className={u.h2}>Your data</h2>
        <div className={u.card}>
          <p className={u.muted}>Under Nigeria&rsquo;s data protection law you can get a copy of your data, correct it, delete your account, or ask a person to review an automatic decision.</p>
          <DataRequestForm />
          {requests.length > 0 && (
            <ul className={u.list}>
              {requests.map((r) => (
                <li key={r.id} className={`${u.row} ${u.between}`}>
                  <span>{DR_TYPE[r.type ?? 'export']} <span className={u.muted}>· {DR_STATUS[r.status ?? 'received']}{r.due_at && r.status !== 'done' ? ` · answered by ${new Date(r.due_at).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos',  day: 'numeric', month: 'short' })}` : ''}</span></span>
                  {r.download_url && <a className="btn btn-line btn-sm" href={r.download_url}>Download</a>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

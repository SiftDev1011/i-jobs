import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { engine, maybe } from '@/lib/engine';
import { APPLICATION_STATUS, MODE } from '@/lib/labels';
import u from '../../_ui/ui.module.css';
import s from '../applications.module.css';
import { CancelButton, Checkin } from './controls';

export const metadata: Metadata = { title: 'Application' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPLY: Record<string, string> = { interview: 'They want to interview you', rejection: 'They said no this time', info_request: 'They asked for more information', auto_reply: 'An automatic reply', other: 'They replied' };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const a = maybe(await (await engine()).GET('/applications/{applicationId}', { params: { path: { applicationId: id } } }));
  if (!a) notFound();
  const st = APPLICATION_STATUS[a.status] ?? { label: a.status, cls: 't-ink' };
  const canCancel = a.status === 'scheduled' && (!a.cancel_until || new Date(a.cancel_until) > new Date());
  const fmt = (d: string) => new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos',  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <main className={u.page}>
      <p className={u.small}><Link href="/app/applications">Applications</Link> / {a.job.company_name}</p>
      <div className={u.head}>
        <div>
          <h1 className={u.h1}>{a.job.title}</h1>
          <p className={u.muted}>{a.job.company_name} · sent by {MODE[a.mode].toLowerCase() === 'you' ? 'you' : MODE[a.mode].toLowerCase()}</p>
        </div>
        <span className={`${u.chip} ${st.cls}`} style={{ fontSize: 14, padding: '4px 12px' }}>{st.label}</span>
      </div>

      {a.status === 'scheduled' && (
        <div className={`${u.notice} ${u.info} ${u.row} ${u.between}`}>
          <span>Sends {a.scheduled_for ? fmt(a.scheduled_for) : 'soon'}.{a.cancel_until ? ` You can cancel until ${fmt(a.cancel_until)}.` : ''}</span>
          {canCancel && <CancelButton id={a.id} />}
        </div>
      )}
      {a.last_reply && <p className={`${u.notice} ${a.last_reply === 'interview' ? u.good : u.info}`}>{REPLY[a.last_reply]}{a.last_reply_at ? ` · ${fmt(a.last_reply_at)}` : ''}. Check your email for the full message.</p>}
      {a.open_checkin?.id && <Checkin applicationId={a.id} checkinId={a.open_checkin.id} question={a.open_checkin.question ?? 'Did you hear back?'} />}

      {a.sent_copy && (
        <section className={u.section}>
          <h2 className={u.h2}>{a.status === 'scheduled' ? 'What will be sent' : 'Exactly what was sent'}</h2>
          <div className={s.mail}>
            <dl className={s.mailHead}>
              {a.sent_copy.from && <><dt>From</dt><dd>{a.sent_copy.from}</dd></>}
              {a.sent_copy.to && <><dt>To</dt><dd>{a.sent_copy.to}</dd></>}
              {a.sent_copy.subject && <><dt>Subject</dt><dd>{a.sent_copy.subject}</dd></>}
              {a.sent_copy.attachments?.length ? <><dt>Attached</dt><dd>{a.sent_copy.attachments.join(', ')}</dd></> : null}
            </dl>
            <div className={s.mailBody}><pre className={u.pre}>{a.sent_copy.body}</pre></div>
          </div>
        </section>
      )}

      {a.events?.length ? (
        <section className={u.section}>
          <h2 className={u.h2}>History</h2>
          <ol className={s.timeline}>
            {a.events.map((e, i) => <li key={i}><b>{APPLICATION_STATUS[e.status ?? '']?.label ?? e.status}</b> <span className={u.muted}>{e.at ? fmt(e.at) : ''}</span></li>)}
          </ol>
        </section>
      ) : null}
      <Link className="btn btn-plain btn-sm" href={`/app/jobs/${a.job.id}`}>View the job</Link>
    </main>
  );
}

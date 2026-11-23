'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { askHelp, createTicket, type Result } from '@/app/actions/member';
import u from '../_ui/ui.module.css';

export function AskBox() {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ answer?: string; source?: string; ticket_id?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null); setAnswer(null);
      const r = await askHelp(q);
      if (r.ok) setAnswer(r.data ?? null); else setError(r.error);
    });
  };
  return (
    <div className={u.card}>
      <form onSubmit={ask} className={u.row}>
        <input className="input" style={{ flex: 1, minWidth: 200, marginTop: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="How do I cancel an application?" aria-label="Your question" maxLength={1000} />
        <button className="btn btn-green" disabled={pending || q.trim().length < 3}>{pending ? 'Looking…' : 'Ask'}</button>
      </form>
      {error && <p className="err">{error}</p>}
      {answer?.answer && (
        <div className={`${u.notice} ${u.info}`}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p>
          <p className={u.small} style={{ marginTop: 6 }}>{answer.source === 'assistant' ? 'Answered by our assistant from the help articles.' : 'From our help articles.'} Not what you needed? Contact a person below.</p>
        </div>
      )}
      {answer && !answer.answer && answer.ticket_id && (
        <p className={`${u.notice} ${u.good}`}>We&rsquo;ve passed this to our team. <Link href={`/app/help/tickets/${answer.ticket_id}`} style={{ textDecoration: 'underline' }}>Follow the conversation</Link>.</p>
      )}
    </div>
  );
}

export function ContactForm() {
  const [r, act, pending] = useActionState<Result<unknown> | null, FormData>(createTicket, null);
  return (
    <form action={act} className={`${u.card} ${u.form}`}>
      <div className={u.grid2}>
        <div className={u.field}><label htmlFor="subject">Subject</label><input className="input" id="subject" name="subject" required minLength={3} maxLength={140} /></div>
        <div className={u.field}><label htmlFor="category">About</label>
          <select className="input" id="category" name="category" defaultValue="other">
            <option value="account">My account</option><option value="payment">A payment</option><option value="scam_report">A scam or suspicious job</option><option value="data_request">My data</option><option value="other">Something else</option>
          </select>
        </div>
      </div>
      <div className={u.field}><label htmlFor="message">Message</label><textarea className="input" id="message" name="message" rows={5} required minLength={3} maxLength={5000} /></div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div><button className="btn btn-green" disabled={pending}>{pending ? 'Sending…' : 'Send'}</button></div>
    </form>
  );
}

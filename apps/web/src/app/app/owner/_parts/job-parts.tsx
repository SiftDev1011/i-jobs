'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { confirmJob, pasteJob, renewJob } from '@/app/actions/owner';
import type { Result } from '@/lib/act';
import { dateLabel } from '@/lib/format';
import { ActionButton } from '../../_parts/action-button';
import u from '../../_ui/ui.module.css';

export function PasteForm({ id }: { id: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [r, act, pending] = useActionState<Result<{ later: string | null }> | null, FormData>(async (p, f) => {
    const out = await pasteJob(id, p, f);
    if (out.ok) form.current?.reset();
    return out;
  }, null);
  return (
    <form ref={form} action={act} className={u.form}>
      <div className={u.field}>
        <label htmlFor="paste">Paste a job post</label>
        <textarea className="input" id="paste" name="text" rows={7} required minLength={40} maxLength={20000} placeholder="Paste the job exactly as it was shared in your group: title, company, what they need and how to apply." />
        <span className={u.help}>Our AI tidies it into a clean listing. You check it, then it goes live for {21} days. Members are never charged to apply.</span>
      </div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      {r?.ok && <p className={`${u.notice} ${u.good}`} role="status">{r.data?.later ? `Got it. Our AI is busy today, so we’ll read it from ${dateLabel(r.data.later, true)}.` : 'Got it. Reading it now — it will appear below for you to check.'}</p>}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Sending…' : 'Clean it up'}</button></div>
    </form>
  );
}

/** Refreshes the page every few seconds while a post is being read, for up to three minutes. */
export function RefreshWhileReading({ reading }: { reading: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!reading) return;
    const started = Date.now();
    const t = setInterval(() => (Date.now() - started > 180_000 ? clearInterval(t) : router.refresh()), 4000);
    return () => clearInterval(t);
  }, [reading, router]);
  return null;
}

type J = { id: string; title?: string; company_name?: string; description?: string; apply_url?: string | null; apply_email?: string | null };

export function ConfirmForm({ id, job }: { id: string; job: J }) {
  const [r, act, pending] = useActionState<Result | null, FormData>(confirmJob.bind(null, id, job.id), null);
  return (
    <form action={act} className={u.form}>
      <div className={u.grid2}>
        <div className={u.field}><label htmlFor={`t-${job.id}`}>Job title</label><input className="input" id={`t-${job.id}`} name="title" defaultValue={job.title} required minLength={3} maxLength={200} /></div>
        <div className={u.field}><label htmlFor={`c-${job.id}`}>Company</label><input className="input" id={`c-${job.id}`} name="company_name" defaultValue={job.company_name} required maxLength={120} /></div>
      </div>
      <div className={u.field}><label htmlFor={`d-${job.id}`}>Description</label><textarea className="input" id={`d-${job.id}`} name="description" rows={8} defaultValue={job.description} required minLength={40} maxLength={20000} /></div>
      <div className={u.field}>
        <label htmlFor={`a-${job.id}`}>How to apply (email or link)</label>
        <input className="input" id={`a-${job.id}`} name="apply_to" defaultValue={job.apply_email ?? job.apply_url ?? ''} required maxLength={500} />
      </div>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div><button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Saving…' : 'Looks right — publish'}</button></div>
    </form>
  );
}

export function RenewButton({ id, jobId }: { id: string; jobId: string }) {
  return <ActionButton run={() => renewJob(id, jobId)} label="Renew" busy="Renewing…" done="Renewed" />;
}

'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { getPack, markApplied } from '@/app/actions/member';
import type { components } from '@/lib/api-types';
import u from '../../_ui/ui.module.css';
import s from './apply.module.css';

type Pack = components['schemas']['ApplyPack'];

/** Prepares the apply pack (answers drafted from the profile), then the member applies and says so. */
export function ApplyPanel({ jobId, autopilot }: { jobId: string; autopilot: boolean }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [state, setState] = useState<'idle' | 'making' | 'later' | 'applied'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const load = () => start(async () => {
    setError(null);
    setState('making');
    const started = Date.now();
    for (;;) {
      const r = await getPack(jobId);
      if (!r.ok) { setError(r.error); setState('idle'); return; }
      if (r.data?.pack) { setPack(r.data.pack); setState('idle'); return; }
      if (r.data?.work?.status === 'scheduled') { setState('later'); return; }
      if (Date.now() - started > 120_000) { setState('later'); return; }
      await new Promise((res) => setTimeout(res, 4000));
    }
  });

  const applied = () => start(async () => {
    const r = await markApplied(jobId);
    if (r.ok) { setApplicationId((r.data as { id?: string } | undefined)?.id ?? null); setState('applied'); }
    else setError(r.error.includes('already') ? 'You’ve already marked this job as applied.' : r.error);
  });

  const copy = async (i: number, textToCopy: string) => {
    try { await navigator.clipboard.writeText(textToCopy); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* select manually */ }
  };

  if (state === 'applied') {
    return (
      <div className={u.card}>
        <p className={`${u.notice} ${u.good}`}>Nice. We&rsquo;ll track it and ask you in a week if you heard back.</p>
        {applicationId && <Link className="btn btn-line btn-sm" href={`/app/applications/${applicationId}`}>See the application</Link>}
      </div>
    );
  }

  return (
    <div className={u.card}>
      <h2 className={u.h2}>Apply</h2>
      {autopilot && <p className={u.muted}>Autopilot can send this one for you if it fits your rules. You can also apply now.</p>}
      {!pack && state !== 'later' && (
        <>
          <p className={u.muted}>We draft the answers this application asks for, from your profile. You check them and apply on the employer&rsquo;s page.</p>
          <button className="btn btn-green btn-block" onClick={load} disabled={pending}>{state === 'making' ? 'Preparing your answers…' : 'Prepare my application'}</button>
        </>
      )}
      {state === 'later' && <p className={`${u.notice} ${u.info}`}>Your answers will be ready soon. We&rsquo;ll notify you; you can also come back to this page.</p>}
      {pack && (
        <>
          {pack.answers?.length ? (
            <ol className={s.answers}>
              {pack.answers.map((a, i) => (
                <li key={i}>
                  <p className={s.q}>{a.question}</p>
                  <p className={s.a}>{a.draft}</p>
                  <button className="btn btn-plain btn-sm" onClick={() => copy(i, a.draft ?? '')}>{copied === i ? 'Copied' : 'Copy'}</button>
                </li>
              ))}
            </ol>
          ) : <p className={u.muted}>This one just needs your CV.</p>}
          {pack.tailored_cv_url && <a className="btn btn-line btn-block" href={pack.tailored_cv_url}>Download your CV for this job</a>}
          <a className="btn btn-green btn-block" href={pack.open_url} target="_blank" rel="noopener noreferrer">Open the application</a>
          <button className="btn btn-line btn-block" onClick={applied} disabled={pending}>I&rsquo;ve applied</button>
        </>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

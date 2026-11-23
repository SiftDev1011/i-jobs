'use client';

import { useState, useTransition } from 'react';
import type { Result } from '@/lib/act';

/**
 * A button that runs one server action. With `confirm`, the first click asks inline
 * ("Sure? Yes / No") instead of a browser dialog.
 */
export function ActionButton({ run, label, busy, done, confirm, className = 'btn btn-line btn-sm' }: {
  run: () => Promise<Result<unknown>>; label: string; busy?: string; done?: string; confirm?: string; className?: string;
}) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = () => start(async () => {
    setAsking(false);
    const r = await run();
    setMsg(r.ok ? (done ? { ok: true, text: done } : null) : { ok: false, text: r.error });
  });
  if (msg?.ok) return <span className="muted-sm" role="status">{msg.text}</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {asking ? (
        <>
          <span className="muted-sm">{confirm}</span>
          <button type="button" className="btn btn-green btn-sm" onClick={go} disabled={pending}>Yes</button>
          <button type="button" className="btn btn-line btn-sm" onClick={() => setAsking(false)}>No</button>
        </>
      ) : (
        <button type="button" className={className} disabled={pending} onClick={() => (confirm ? setAsking(true) : go())}>{pending ? busy ?? 'Working…' : label}</button>
      )}
      {msg && !msg.ok && <span className="err" role="alert">{msg.text}</span>}
    </span>
  );
}

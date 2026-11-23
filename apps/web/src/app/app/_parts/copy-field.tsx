'use client';

import { useState } from 'react';
import u from '../_ui/ui.module.css';

/** A read-only value with a Copy button; falls back to selecting the text. */
export function CopyField({ label, value, id }: { label: string; value: string; id: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={u.field}>
      <label htmlFor={id}>{label}</label>
      <div className={u.row} style={{ flexWrap: 'nowrap' }}>
        <input className="input" id={id} value={value} readOnly onFocus={(e) => e.currentTarget.select()} style={{ minWidth: 0, flex: 1 }} />
        <button type="button" className="btn btn-line btn-sm" onClick={async () => {
          try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1600); }
          catch { (document.getElementById(id) as HTMLInputElement | null)?.select(); }
        }}>{done ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

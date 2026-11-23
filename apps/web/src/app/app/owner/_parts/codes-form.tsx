'use client';

import { useActionState, useMemo, useState } from 'react';
import { buyCodes } from '@/app/actions/owner';
import type { Result } from '@/lib/act';
import { money } from '@/lib/format';
import u from '../../_ui/ui.module.css';

export function CodesForm({ id, unitMinor }: { id: string; unitMinor: number }) {
  const [qty, setQty] = useState(10);
  const idem = useMemo(() => crypto.randomUUID(), []);
  const [r, act, pending] = useActionState<Result | null, FormData>(buyCodes.bind(null, id), null);
  return (
    <form action={act} className={u.form}>
      <input type="hidden" name="idem" value={idem} />
      <div className={u.row} style={{ alignItems: 'flex-end' }}>
        <div className={u.field}>
          <label htmlFor="quantity">How many codes</label>
          <input className="input" id="quantity" name="quantity" type="number" min={1} max={10000} value={qty} onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: 140 }} required />
        </div>
        <p style={{ margin: '0 0 10px' }}>You pay <b>{money(unitMinor * Math.max(qty, 0), 'NGN')}</b> <span className={u.muted}>({money(unitMinor, 'NGN')} each)</span></p>
      </div>
      <label className={u.toggle}>
        <input type="checkbox" name="accept_terms" required />
        <span><b>Codes never expire and can’t be refunded</b><span>Each code gives one person one membership period. Unused codes are voided only if the community is removed.</span></span>
      </label>
      {r && !r.ok && <p className="err">{r.error}</p>}
      <div><button className="btn btn-green btn-sm" disabled={pending || qty < 1}>{pending ? 'Opening checkout…' : 'Pay with Paga'}</button></div>
    </form>
  );
}

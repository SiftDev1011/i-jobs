'use client';

import { useActionState, useState } from 'react';
import { connectAts, disconnectAts } from '@/app/actions/employer';
import type { Result } from '@/lib/act';
import { ActionButton } from '../../_parts/action-button';
import u from '../../_ui/ui.module.css';

const HINT: Record<string, string> = {
  greenhouse: 'Board token: the name in boards.greenhouse.io/<token>. Key: a Job Board API key.',
  lever: 'Board token: the name in jobs.lever.co/<token>. Key: an API key with postings and applications access.',
  ashby: 'Board token: the name in jobs.ashbyhq.com/<token>. Key: an API key with candidate access.',
};

export function ConnectAts({ employerId }: { employerId: string }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('greenhouse');
  const [r, act, pending] = useActionState<Result | null, FormData>(connectAts.bind(null, employerId), null);
  if (r?.ok) return <p className={`${u.notice} ${u.good}`}>Connected. We tested the key and stored it encrypted.</p>;
  if (!open) return <div><button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(true)}>Connect a hiring system</button></div>;
  return (
    <form action={act} className={u.form}>
      <div className={u.grid2}>
        <div className={u.field}>
          <label htmlFor="provider">System</label>
          <select className="input" id="provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select>
        </div>
        <div className={u.field}><label htmlFor="board_token">Board token</label><input className="input" id="board_token" name="board_token" required maxLength={120} pattern="[A-Za-z0-9_.\-]+" autoComplete="off" /></div>
      </div>
      <div className={u.field}><label htmlFor="api_key">API key</label><input className="input" id="api_key" name="api_key" type="password" required minLength={8} maxLength={500} autoComplete="off" /><span className={u.help}>{HINT[provider]} We test it first, store it encrypted and only ever show the last four characters.</span></div>
      {r && !r.ok && <p className="err" role="alert">{r.error}</p>}
      <div className={u.row}>
        <button className="btn btn-green btn-sm" disabled={pending}>{pending ? 'Testing the key…' : 'Connect'}</button>
        <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function DisconnectAts({ employerId, integrationId }: { employerId: string; integrationId: string }) {
  return <ActionButton run={() => disconnectAts(employerId, integrationId)} label="Disconnect" confirm="Disconnect and delete the key?" done="Disconnected" />;
}

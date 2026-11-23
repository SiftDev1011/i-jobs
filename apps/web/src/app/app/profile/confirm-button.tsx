'use client';

import { useTransition } from 'react';
import { confirmProfile } from '@/app/actions/member';

export function ConfirmButton() {
  const [pending, start] = useTransition();
  return <button className="btn btn-green btn-sm" disabled={pending} onClick={() => start(async () => { await confirmProfile(); })}>{pending ? 'Saving…' : 'It’s accurate'}</button>;
}

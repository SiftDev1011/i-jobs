'use client';

import { useTransition } from 'react';
import { markNotificationsRead } from '@/app/actions/member';

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return <button className="btn btn-plain btn-sm" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(); })}>Mark all as read</button>;
}

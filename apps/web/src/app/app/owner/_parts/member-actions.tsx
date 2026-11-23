'use client';

import { decideMember } from '@/app/actions/owner';
import { ActionButton } from '../../_parts/action-button';

export function MemberActions({ id, membershipId, status, step, canNudge }: { id: string; membershipId: string; status: string; step: string; canNudge: boolean }) {
  if (status === 'pending_approval') return (
    <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
      <ActionButton run={() => decideMember(id, membershipId, 'approve')} label="Let in" busy="Letting in…" done="Let in" className="btn btn-green btn-sm" />
      <ActionButton run={() => decideMember(id, membershipId, 'decline')} label="Decline" confirm="Decline this request?" done="Declined" />
    </span>
  );
  if (canNudge) return <ActionButton run={() => decideMember(id, membershipId, 'nudge')} label="Remind" busy="Sending…" done="Reminder sent" />;
  if (['pending_payment', 'trialing', 'active'].includes(status) && step !== 'complete') return <span className="muted-sm">Reminded recently</span>;
  return null;
}

import Link from 'next/link';
import { engine, features, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import { MEMBER_STATUS, ONBOARDING_STEP } from '@/lib/labels';
import { StatusChip } from '../../../_parts/chip';
import u from '../../../_ui/ui.module.css';
import { MemberActions } from '../../_parts/member-actions';

const FILTERS = [
  ['', 'Everyone'], ['awaiting_approval', 'Wants to join'], ['not_paid_yet', 'Not paid'], ['on_trial', 'Free week'],
  ['stuck_no_cv', 'No CV yet'], ['stuck_no_rules', 'No autopilot yet'], ['fully_set_up', 'Fully set up'],
] as const;
type Stage = Exclude<(typeof FILTERS)[number][0], ''>;

export default async function Members({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { id } = await params;
  const { stage: raw } = await searchParams;
  const stage = FILTERS.some(([k]) => k && k === raw) ? (raw as Stage) : undefined;
  const page = must(await (await engine()).GET('/owner/communities/{communityId}/members', { params: { path: { communityId: id }, query: { ...(stage ? { stage } : {}), limit: 100 } } }));
  const items = page.items ?? [];
  const filters = (await features()).free_weeks ? FILTERS : FILTERS.filter(([k]) => k !== 'on_trial');

  return (
    <section className={u.section}>
      <p className={u.muted}>You see each member’s first name and how far they’ve got. Reminders are sent by i-jobs; we never share how to reach them.</p>
      <div className={u.checks} role="list" aria-label="Show">
        {filters.map(([k, label]) => (
          <Link key={k} role="listitem" href={`/app/owner/${id}/members${k ? `?stage=${k}` : ''}`} className={u.check} aria-current={(stage ?? '') === k ? 'true' : undefined}
            style={(stage ?? '') === k ? { background: 'var(--ink)', color: 'var(--white)', borderColor: 'var(--ink)' } : undefined}>{label}</Link>
        ))}
      </div>
      {items.length === 0 ? (
        <div className={u.empty}><p>{stage ? 'No one at this step right now.' : 'No members yet. Share your join link or send invites to get started.'}</p>
          {!stage && <Link className="btn btn-green btn-sm" href={`/app/owner/${id}/invites`}>Send invites</Link>}</div>
      ) : (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead><tr><th>Name</th><th>Membership</th><th>Progress</th><th>Joined</th><th>Until</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.membership_id}>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{m.first_name ?? 'A member'}</b></td>
                  <td><StatusChip value={m.status} map={MEMBER_STATUS} /></td>
                  <td>{ONBOARDING_STEP[m.onboarding_step ?? ''] ?? '—'}</td>
                  <td className={u.num}>{dateLabel(m.joined_at)}</td>
                  <td className={u.num}>{dateLabel(m.status === 'trialing' ? m.trial_ends_at : m.current_period_end)}</td>
                  <td><MemberActions id={id} membershipId={m.membership_id!} status={m.status ?? ''} step={m.onboarding_step ?? ''} canNudge={!!m.can_nudge} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

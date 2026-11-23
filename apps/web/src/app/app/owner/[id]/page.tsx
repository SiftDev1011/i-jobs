import Link from 'next/link';
import { engine, features, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import { VERIFICATION } from '@/lib/labels';
import { CopyField } from '../../_parts/copy-field';
import { StatusChip } from '../../_parts/chip';
import u from '../../_ui/ui.module.css';
import { loadCommunity } from '../_parts/load';
import { AppealForm, DemoTour } from '../_parts/overview-parts';

const STAGES = [
  ['invited', 'Invited', null],
  ['joined', 'Joined', null],
  ['awaiting_approval', 'Waiting for you to approve', 'awaiting_approval'],
  ['not_paid_yet', 'Not paid yet', 'not_paid_yet'],
  ['on_trial', 'On a free week', 'on_trial'],
  ['paid', 'Paid', null],
  ['stuck_no_cv', 'Paid, no CV yet', 'stuck_no_cv'],
  ['stuck_no_rules', 'CV in, no autopilot yet', 'stuck_no_rules'],
  ['fully_set_up', 'Fully set up', 'fully_set_up'],
] as const;

export default async function Overview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ applied?: string }> }) {
  const { id } = await params;
  const { applied } = await searchParams;
  const c = await loadCommunity(id);
  const api = await engine();
  const path = { params: { path: { communityId: id } } };
  const [funnel, strikes, f] = await Promise.all([api.GET('/owner/communities/{communityId}/funnel', path).then(must), api.GET('/owner/communities/{communityId}/strikes', path).then(must), features()]);
  // Free weeks need texts; without them the row shows only for members still on one.
  const stages = STAGES.filter(([k]) => k !== 'on_trial' || f.free_weeks || (funnel.on_trial ?? 0) > 0);
  const top = Math.max(1, ...stages.map(([k]) => funnel[k] ?? 0));
  const live = c.status === 'active';

  return (
    <>
      {applied && <p className={`${u.notice} ${u.good}`}>Thanks — your application is in. We check new communities within two working days and email you the result.</p>}
      {c.status === 'pending_review' && c.verification === 'needs_more_info' && <p className={u.notice}>We need a little more before we can approve {c.name}. Check your email for what to send.</p>}
      {c.verification === 'rejected' && <p className={`${u.notice} ${u.bad}`}>We couldn’t approve this community. Check your email for why, or contact support.</p>}
      {c.status === 'suspended' && <p className={`${u.notice} ${u.bad}`}>{c.name} is suspended after three strikes. New members can’t join. You can appeal each strike below.</p>}
      {c.status === 'banned' && <p className={`${u.notice} ${u.bad}`}>{c.name} has been removed from i-jobs. Members keep access until the end of what they paid for.</p>}

      <section className={u.section}>
        <h2 className={u.h2}>Share</h2>
        {live ? (
          <div className={`${u.card} ${u.grid2}`}>
            <CopyField id="join-link" label="Join link" value={c.join_url ?? ''} />
            <CopyField id="invite-code" label="Invite code" value={c.invite_code ?? ''} />
            <CopyField id="finds-link" label="Job finds page (free to view, for your group)" value={c.job_finds_url ?? ''} />
          </div>
        ) : (
          <p className={u.muted}>Your join link and invite code work once {c.name} is approved.</p>
        )}
      </section>

      <section className={u.section}>
        <div className={`${u.row} ${u.between}`}>
          <h2 className={u.h2}>How your members are doing</h2>
          <Link className="btn btn-line btn-sm" href={`/app/owner/${id}/members`}>See members</Link>
        </div>
        <div className={u.grid3}>
          <div className={u.stat}><span>Joined</span><b>{funnel.joined ?? 0}</b></div>
          <div className={u.stat}><span>Fully set up</span><b>{funnel.fully_set_up ?? 0}</b></div>
          <div className={u.stat}><span>Interviews landed</span><b>{funnel.interviews_landed ?? 0}</b></div>
        </div>
        <div className={u.card}>
          <div className={u.funnel}>
            {stages.map(([key, label, stage]) => {
              const n = funnel[key] ?? 0;
              return (
                <div key={key} className={u.funnelRow}>
                  {stage && n > 0 ? <Link href={`/app/owner/${id}/members?stage=${stage}`}>{label}</Link> : <span>{label}</span>}
                  <span className={u.bar}><i style={{ width: `${(n / top) * 100}%` }} /></span>
                  <b className={u.num}>{n}</b>
                </div>
              );
            })}
          </div>
          <p className={u.help}>Interviews are counted across all members, never per person. You see first names and progress only.</p>
        </div>
      </section>

      <section className={u.section}>
        <h2 className={u.h2}>Demo tour</h2>
        <div className={u.card}>
          <p className={u.muted}>Show someone how i-jobs works before they join: a read-only tour with sample matches and applications. Nothing is ever sent.</p>
          <DemoTour id={id} left={c.demo_tours_left ?? 0} />
        </div>
      </section>

      {strikes.length > 0 && (
        <section className={u.section}>
          <h2 className={u.h2}>Strikes ({c.strike_count ?? strikes.length} of 3)</h2>
          <p className={u.muted}>A strike is given when a job posted in your community is removed, for example as a scam. Three strikes suspend the community.</p>
          <ul className={u.list}>
            {strikes.map((s) => (
              <li key={s.id} className={u.card}>
                <div className={`${u.row} ${u.between}`}>
                  <b>{s.reason}</b>
                  <span className={u.muted}>{dateLabel(s.created_at)}</span>
                </div>
                {s.appeal ? (
                  <p className={u.row}><span className={u.muted}>Appeal:</span> {s.appeal === 'pending' ? <span className={`${u.chip} ${u.yellow}`}>Waiting for a decision</span> : <StatusChip value={s.appeal} map={VERIFICATION} />}</p>
                ) : s.can_appeal ? <AppealForm id={id} strikeId={s.id!} /> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

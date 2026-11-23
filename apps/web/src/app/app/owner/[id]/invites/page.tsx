import { engine, features, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import { INVITE_STATUS } from '@/lib/labels';
import { StatusChip } from '../../../_parts/chip';
import u from '../../../_ui/ui.module.css';
import { InviteForm } from '../../_parts/invite-form';
import { loadCommunity } from '../../_parts/load';

export default async function Invites({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCommunity(id);
  const items = must(await (await engine()).GET('/owner/communities/{communityId}/invites', { params: { path: { communityId: id } } })).items ?? [];
  const joined = items.filter((i) => i.status === 'joined').length;

  return (
    <>
      <section className={u.section}>
        <h2 className={u.h2}>Invite your group</h2>
        <div className={u.card}>
          {c.status === 'active' ? <InviteForm id={id} phone={(await features()).phone_invites} /> : <p className={u.muted}>Invites open once {c.name} is approved.</p>}
        </div>
      </section>
      <section className={u.section}>
        <div className={`${u.row} ${u.between}`}>
          <h2 className={u.h2}>Sent</h2>
          {items.length > 0 && <span className={u.muted}>{joined} of {items.length} joined</span>}
        </div>
        {items.length === 0 ? <p className={u.muted}>No invites yet.</p> : (
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th>To</th><th>By</th><th>Status</th><th>Sent</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.target_masked}</td>
                    <td>{i.channel === 'phone' ? 'Text' : 'Email'}</td>
                    <td><StatusChip value={i.status} map={INVITE_STATUS} /></td>
                    <td className={u.num}>{dateLabel(i.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

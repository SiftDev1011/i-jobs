import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import { COMMUNITY_JOB_STATE } from '@/lib/labels';
import { StatusChip } from '../../../_parts/chip';
import u from '../../../_ui/ui.module.css';
import { ConfirmForm, PasteForm, RefreshWhileReading, RenewButton } from '../../_parts/job-parts';
import { loadCommunity } from '../../_parts/load';

export default async function Jobs({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCommunity(id);
  const items = must(await (await engine()).GET('/owner/communities/{communityId}/jobs', { params: { path: { communityId: id } } })).items ?? [];
  const reading = items.filter((j) => j.state === 'reading');
  const toCheck = items.filter((j) => j.state === 'needs_confirmation');
  const rest = items.filter((j) => j.state !== 'reading' && j.state !== 'needs_confirmation');

  return (
    <>
      <RefreshWhileReading reading={reading.length} />
      <section className={u.section}>
        <h2 className={u.h2}>Post a job to your members</h2>
        <div className={u.card}>{c.status === 'active' ? <PasteForm id={id} /> : <p className={u.muted}>Posting opens once {c.name} is approved.</p>}</div>
      </section>

      {reading.length > 0 && <p className={`${u.notice} ${u.info}`} role="status">Reading {reading.length} post{reading.length === 1 ? '' : 's'}… this page updates by itself.</p>}

      {toCheck.length > 0 && (
        <section className={u.section}>
          <h2 className={u.h2}>Check and publish</h2>
          <p className={u.muted}>Fix anything our AI got wrong. Nothing goes live until you publish it.</p>
          {toCheck.map((j) => <div key={j.job.id} className={u.card}><ConfirmForm id={id} job={j.job} /></div>)}
        </section>
      )}

      <section className={u.section}>
        <h2 className={u.h2}>Your posts</h2>
        {rest.length === 0 ? <p className={u.muted}>Nothing posted yet.</p> : (
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th>Job</th><th>Status</th><th>Ends</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rest.map((j) => (
                  <tr key={j.job.id}>
                    <td>{j.state === 'live' ? <Link href={`/jobs/${j.job.id}`}><b>{j.job.title}</b></Link> : <b>{j.job.title}</b>}<br /><span className={u.muted}>{j.job.company_name}</span></td>
                    <td><StatusChip value={j.state} map={COMMUNITY_JOB_STATE} /></td>
                    <td className={u.num}>{dateLabel(j.expires_at)}</td>
                    <td>{j.can_renew && <RenewButton id={id} jobId={j.job.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={u.help}>Posts stay up for 21 days and can be renewed up to 60 days after they were first posted. A post “in review” is being checked by our team; we don’t share why.</p>
      </section>
    </>
  );
}

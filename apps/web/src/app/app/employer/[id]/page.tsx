import Link from 'next/link';
import { notFound } from 'next/navigation';
import { engine, EngineError, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import { EMPLOYER_JOB_STATE, VERIFICATION } from '@/lib/labels';
import { StatusChip } from '../../_parts/chip';
import u from '../../_ui/ui.module.css';
import { ConnectAts, DisconnectAts } from '../_parts/ats-parts';

const PROVIDER: Record<string, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

export default async function Company({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmed?: string; posted?: string }> }) {
  const { id } = await params;
  const { confirmed, posted } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d;
  try {
    d = must(await (await engine()).GET('/employers/{employerId}', { params: { path: { employerId: id } } }));
  } catch (e) {
    if (e instanceof EngineError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const e = d.employer!;
  const checks = e.checks ?? {};
  const verified = e.verification === 'verified';
  const postedJob = posted ? d.jobs?.find((j) => j.id === posted) : null;

  return (
    <main className={`${u.page} ${u.wide}`}>
      <div className={u.head}>
        <div>
          <p className={u.crumb}><Link href="/app/employer">Hiring</Link></p>
          <h1 className={u.h1}>{e.name}</h1>
          <p className={u.muted}>{e.domain}</p>
        </div>
        <div className={u.row}>
          <StatusChip value={e.verification} map={VERIFICATION} />
          <Link className="btn btn-green btn-sm" href={`/app/employer/${id}/post`}>Post a job</Link>
        </div>
      </div>

      {confirmed && <p className={`${u.notice} ${u.good}`}>Work email confirmed. We’re checking your website now; a person checks the company registration within two working days.</p>}
      {postedJob && <p className={`${u.notice} ${postedJob.state === 'live' ? u.good : u.info}`}>{postedJob.state === 'live' ? `“${postedJob.title}” is live.` : `“${postedJob.title}” is in review. Jobs from companies still being verified are checked by a person first.`}</p>}

      {!verified && (
        <section className={u.section}>
          <h2 className={u.h2}>Verification</h2>
          <div className={u.card}>
            <ul className={u.list}>
              {([['work_email', 'Work email on your domain'], ['website', 'Website is yours and uses https'], ['registry', 'Company registration checked by a person']] as const).map(([k, label]) => (
                <li key={k} className={`${u.row} ${u.between}`}><span>{label}</span>{checks[k] ? <span className={`${u.chip} ${u.good}`}>Done</span> : <span className={`${u.chip} ${u.gray}`}>Waiting</span>}</li>
              ))}
            </ul>
            <p className={u.help}>Until all three are done, your jobs are checked by a person before they go live.</p>
          </div>
        </section>
      )}

      <section className={u.section}>
        <h2 className={u.h2}>Jobs</h2>
        {!d.jobs?.length ? (
          <div className={u.empty}><p>No jobs posted yet.</p><Link className="btn btn-green btn-sm" href={`/app/employer/${id}/post`}>Post your first job</Link></div>
        ) : (
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th>Job</th><th>Status</th><th>Applicants</th><th>Applications go to</th><th>Ends</th></tr></thead>
              <tbody>
                {d.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.state === 'live' ? <Link href={`/jobs/${j.id}`}><b>{j.title}</b></Link> : <b>{j.title}</b>}<br /><span className={u.muted}>Posted {dateLabel(j.posted_at)}</span></td>
                    <td><StatusChip value={j.state} map={EMPLOYER_JOB_STATE} /></td>
                    <td className={u.num}>{j.applicants}{j.max_applicants ? ` / ${j.max_applicants}` : ''}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{j.apply_to ?? '—'}</td>
                    <td className={u.num}>{dateLabel(j.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={u.help}>Applications sent through i-jobs arrive by email from the applicant’s relay address, so you can reply as normal.</p>
      </section>

      <p className={u.help}><Link href="/app/employer/verify" style={{ textDecoration: 'underline' }}>Hire for another company too</Link></p>

      <section className={u.section}>
        <h2 className={u.h2}>Hiring system</h2>
        <div className={u.card}>
          {d.integrations?.length ? (
            <ul className={u.list}>
              {d.integrations.map((i) => (
                <li key={i.id} className={`${u.row} ${u.between}`}>
                  <span><b>{PROVIDER[i.provider ?? ''] ?? i.provider}</b> · {i.board_token} <span className={u.muted}>· key ending {i.key_last4} · since {dateLabel(i.connected_at)}</span></span>
                  <DisconnectAts employerId={id} integrationId={i.id!} />
                </li>
              ))}
            </ul>
          ) : <p className={u.muted}>Connect Greenhouse, Lever or Ashby so applications arrive straight in your pipeline.</p>}
          {verified ? <ConnectAts employerId={id} /> : <p className={u.help}>You can connect a hiring system once the company is verified.</p>}
        </div>
      </section>
    </main>
  );
}

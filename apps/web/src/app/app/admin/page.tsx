import Link from 'next/link';
import { engine, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import u from '../_ui/ui.module.css';
import { BanForm, CommunityVerify, GenericDecision, JobDecision, TakedownForm } from './_parts/review-parts';
import { needs } from './_parts/staff';

const SUBJECTS = [['', 'Everything'], ['job', 'Jobs'], ['community', 'Communities'], ['employer', 'Employers'], ['user', 'People']] as const;
const STATUSES = [['', 'To do'], ['escalated', 'Escalated'], ['approved', 'Approved'], ['rejected', 'Rejected']] as const;
type Subject = Exclude<(typeof SUBJECTS)[number][0], ''>;
type Status = Exclude<(typeof STATUSES)[number][0], ''>;

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ subject?: string; status?: string; cursor?: string }> }) {
  const role = await needs('/app/admin');
  const sp = await searchParams;
  const subject = SUBJECTS.some(([k]) => k && k === sp.subject) ? (sp.subject as Subject) : undefined;
  const status = STATUSES.some(([k]) => k && k === sp.status) ? (sp.status as Status) : undefined;
  const page = must(await (await engine()).GET('/admin/moderation', { params: { query: { ...(subject ? { subject } : {}), ...(status ? { status } : {}), ...(sp.cursor ? { cursor: sp.cursor } : {}), limit: 25 } } }));
  const items = page.items ?? [];
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ subject, status, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/app/admin${q.size ? `?${q}` : ''}`;
  };
  const open = !status || status === 'escalated';

  return (
    <>
      <div className={`${u.row} ${u.between}`}>
        <div className={u.checks}>
          {SUBJECTS.map(([k, label]) => <Link key={k} className={u.check} href={href({ subject: k || undefined, cursor: undefined })} style={(subject ?? '') === k ? { background: 'var(--ink)', color: 'var(--white)', borderColor: 'var(--ink)' } : undefined}>{label}</Link>)}
        </div>
        <div className={u.checks}>
          {STATUSES.map(([k, label]) => <Link key={k} className={u.check} href={href({ status: k || undefined, cursor: undefined })} style={(status ?? '') === k ? { background: 'var(--ink)', color: 'var(--white)', borderColor: 'var(--ink)' } : undefined}>{label}</Link>)}
        </div>
      </div>

      <details className={u.card}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Take down a live job</summary>
        <TakedownForm />
      </details>

      {items.length === 0 ? <div className={u.empty}><p>Nothing here. {open ? 'The queue is clear.' : ''}</p></div> : (
        <ul className={u.list}>
          {items.map((i) => {
            const s = i.subject;
            const reason = i.reason_internal ?? '';
            const appeal = i.subject_type === 'community' && reason.startsWith('strike appeal');
            const banCall = i.subject_type === 'community' && /strikes: suspended/.test(reason);
            const decided = i.status === 'approved' || i.status === 'rejected';
            return (
              <li key={i.id} className={u.card}>
                <div className={`${u.row} ${u.between}`}>
                  <span className={u.row}>
                    <span className={`${u.chip} ${u.gray}`}>{i.subject_type}</span>
                    {i.status !== 'open' && <span className={`${u.chip} ${i.status === 'escalated' ? u.yellow : i.status === 'approved' ? u.good : u.bad}`}>{i.status}</span>}
                    {i.risk_score != null && <span className={`${u.chip} ${i.risk_score >= 0.6 ? u.bad : u.yellow}`}>risk {Math.round(i.risk_score * 100)}</span>}
                  </span>
                  <span className={u.muted}>{dateLabel(i.created_at, true)}</span>
                </div>
                <div>
                  <b style={{ fontSize: 16.5 }}>{s?.title ?? 'This no longer exists'}</b>
                  <p className={u.muted} style={{ marginTop: 2 }}>Why it’s here: {reason || '—'}</p>
                </div>
                {s && s.lines.length > 0 && <ul className={u.small} style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)' }}>{s.lines.map((l, n) => <li key={n}>{l}</li>)}</ul>}
                {s && s.links.length > 0 && (
                  <p className={u.small} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {s.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" style={{ color: 'var(--action-ink)', overflowWrap: 'anywhere' }}>{l}</a>)}
                  </p>
                )}
                {s?.text && <details><summary style={{ cursor: 'pointer' }} className={u.small}>Show the full text</summary><pre className={u.pre} style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}>{s.text}</pre></details>}
                {i.subject_type === 'job' && <Link className={u.small} href={`/jobs/${i.subject_id}`} target="_blank" style={{ color: 'var(--action-ink)' }}>Open the job page</Link>}

                {!decided && (
                  i.subject_type === 'job' ? <JobDecision itemId={i.id!} />
                  : appeal ? <GenericDecision itemId={i.id!} approve="Uphold appeal (remove strike)" reject="Keep the strike" />
                  : banCall ? (
                    <>
                      {role === 'admin' ? <BanForm communityId={i.subject_id!} /> : <p className={u.muted}>Only an admin can ban.</p>}
                      <GenericDecision itemId={i.id!} approve="Close without banning" reject="Close" />
                    </>
                  )
                  : i.subject_type === 'community' ? (
                    <>
                      <CommunityVerify communityId={i.subject_id!} />
                      {role === 'admin' && <details><summary className={u.small} style={{ cursor: 'pointer' }}>Ban instead</summary><BanForm communityId={i.subject_id!} /></details>}
                    </>
                  )
                  : i.subject_type === 'employer' ? <GenericDecision itemId={i.id!} approve="Registration checks out" reject="Doesn’t check out" />
                  : <GenericDecision itemId={i.id!} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {page.next_cursor && <Link className="btn btn-line btn-sm" href={href({ cursor: page.next_cursor })}>Next page</Link>}
    </>
  );
}

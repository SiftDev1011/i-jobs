import Link from 'next/link';
import type { components } from '@/lib/api-types';
import { jobBadge, payLabel, timeAgo, typeLabel, whereLabel } from '@/lib/format';
import { CompanyLogo } from './company-logo';
import { Icon } from './icons';
import s from './job-card.module.css';

export type JobSummary = components['schemas']['JobSummary'];

/** A job in a grid: logo and company, the title, pay, then type and age. The whole card opens the job. */
export function JobCard({ job, hidden = false, compact = false, base = '/jobs' }: { job: JobSummary; hidden?: boolean; compact?: boolean; base?: string }) {
  const badge = jobBadge(job);
  const pay = payLabel(job.pay);
  const type = typeLabel(job.employment_type);
  return (
    <article className={`${s.job} ${compact ? s.compact : ''}`} aria-hidden={hidden || undefined}>
      <div className={s.head}>
        <CompanyLogo name={job.company_name} url={job.company_logo_url} size={compact ? 38 : 44} />
        <div className={s.who}>
          <p className={s.co}>{job.company_name}</p>
          <p className={s.where}><Icon name="pin" />{whereLabel(job)}</p>
        </div>
      </div>
      <h3 className={s.title}>
        <Link href={`${base}/${job.id}`} tabIndex={hidden ? -1 : undefined} className={s.link}>{job.title}</Link>
      </h3>
      <p className={pay ? s.pay : s.payNone}>{pay ? <>{pay.amount} <small>{pay.period}</small></> : 'Pay not stated'}</p>
      <div className={s.foot}>
        <span className={s.meta}>{[type, timeAgo(job.first_seen_at)].filter(Boolean).join(' · ')}</span>
        {job.match_score != null ? <span className="tag t-green">{job.match_score}% match</span>
          : badge ? <span className={`badge ${badge.cls}`}><Icon name={badge.icon} />{badge.label}</span> : null}
      </div>
      {job.source?.credit && !compact && <p className={s.credit}>{job.source.credit}</p>}
    </article>
  );
}

import Link from 'next/link';
import type { components } from '@/lib/api-types';
import { companyTile, jobBadge, payLabel, typeLabel, whereLabel } from '@/lib/format';
import { Icon } from './icons';
import s from './job-card.module.css';

export type JobSummary = components['schemas']['JobSummary'];

/** The job card used on the landing wall and in search results. */
export function JobCard({ job, hidden = false, compact = false }: { job: JobSummary; hidden?: boolean; compact?: boolean }) {
  const tile = companyTile(job.company_name);
  const badge = jobBadge(job);
  const pay = payLabel(job.pay);
  const type = typeLabel(job.employment_type);
  return (
    <article className={`${s.job} ${compact ? s.compact : ''}`} aria-hidden={hidden || undefined}>
      <div className={s.top}>
        <span className={`tile ${tile.colour}`}>{tile.initials}</span>
        {badge && <span className={`badge ${badge.cls} ${s.badge}`}><Icon name={badge.icon} />{badge.label}</span>}
      </div>
      <div>
        <h3 className={s.title}>
          <Link href={`/jobs/${job.id}`} tabIndex={hidden ? -1 : undefined} className={s.link}>{job.title}</Link>
        </h3>
        <p className={s.co}>{job.company_name}</p>
      </div>
      <div className={s.tags}>
        <span className="tag">{whereLabel(job)}</span>
        {type && <span className="tag">{type}</span>}
        {job.match_score != null && <span className="tag t-green">{job.match_score}% match</span>}
      </div>
      {pay && <p className={s.pay}>{pay.amount} <small>{pay.period}</small></p>}
      {job.source?.credit && <p className={s.credit}>{job.source.credit}</p>}
    </article>
  );
}

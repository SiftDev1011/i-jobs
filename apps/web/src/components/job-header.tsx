import type { components } from '@/lib/api-types';
import { dateLabel, jobBadge, payLabel, timeAgo, typeLabel, whereLabel } from '@/lib/format';
import { CompanyLogo } from './company-logo';
import { Icon } from './icons';
import s from './job-header.module.css';

type JobDetail = components['schemas']['JobDetail'];

const SENIORITY: Record<string, string> = { intern: 'Intern', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead', executive: 'Executive' };

/** The top of a job page: who, what, where, and the four facts people look for first. */
export function JobHeader({ job }: { job: JobDetail }) {
  const pay = payLabel(job.pay);
  const type = typeLabel(job.employment_type);
  const badge = jobBadge(job);
  const level = job.seniority ? SENIORITY[job.seniority] ?? job.seniority : null;
  return (
    <header className={s.header}>
      <div className={s.top}>
        <CompanyLogo name={job.company_name} url={job.company_logo_url} size={64} />
        <div className={s.who}>
          <h1 className={s.h}>{job.title}</h1>
          <p className={s.co}>{job.company_name}{job.community?.name ? <span className={s.shared}> · shared by {job.community.name}</span> : null}</p>
        </div>
      </div>
      <ul className={s.chips} aria-label="About this job">
        <li className="tag"><Icon name="pin" />{whereLabel(job)}</li>
        {level && <li className="tag">{level}</li>}
        {badge && <li className={`badge ${badge.cls}`}><Icon name={badge.icon} />{badge.label}</li>}
        {job.match_score != null && <li className="tag t-green">{job.match_score}% match</li>}
      </ul>
      <dl className={s.facts}>
        <div><dt>Pay</dt><dd>{pay ? <>{pay.amount} <small>{pay.period}</small></> : <span className={s.none}>Not stated</span>}</dd></div>
        <div><dt>Job type</dt><dd>{type ?? <span className={s.none}>Not stated</span>}</dd></div>
        <div><dt>Posted</dt><dd>{timeAgo(job.original_posted_at ?? job.first_seen_at)}</dd></div>
        <div><dt>Closes</dt><dd>{job.deadline_at ? dateLabel(job.deadline_at) : <span className={s.none}>No deadline given</span>}</dd></div>
      </dl>
    </header>
  );
}

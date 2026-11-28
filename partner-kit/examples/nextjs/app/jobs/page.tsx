// A "Jobs for you" page: the signed-in user's matches from i-jobs.
import { getSignedInUser } from '@/lib/auth'; // ← your own auth
import { IjobsError } from '@/lib/ijobs-client';
import { ijobs, linkedUser } from '@/lib/ijobs';
import { CvUpload } from '@/components/cv-upload';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const user = await getSignedInUser();
  if (!user) {
    // Not signed in: show public jobs.
    const { items } = await ijobs.jobs({ limit: 24 });
    return <JobList title="Remote jobs" jobs={items} />;
  }

  const { me, consentUrl } = await linkedUser(user);
  if (!me) {
    // They already have an i-jobs account: they must agree to link it first.
    return (
      <section>
        <h1>Connect your i-jobs account</h1>
        <p>You already use i-jobs. Agree to share your profile with us to see your matches here.</p>
        <a href={consentUrl!}>Connect i-jobs</a>
      </section>
    );
  }

  const account = await me.account();
  if (account.features_locked) {
    return <p>Job features need a parent’s approval first. We’ve sent them an email.</p>; // see README: requestParentApproval
  }

  try {
    await me.profile();
  } catch (e) {
    if (e instanceof IjobsError && e.status === 404) {
      return (
        <section>
          <h1>Get matched to jobs</h1>
          <p>Upload your CV and we’ll find jobs that fit.</p>
          <CvUpload />
        </section>
      );
    }
    throw e;
  }

  const { items } = await me.matches({ limit: 24 });
  return <JobList title="Jobs for you" jobs={items.map((m: any) => ({ ...m.job, score: m.score }))} />;
}

function JobList({ title, jobs }: { title: string; jobs: any[] }) {
  return (
    <section>
      <h1>{title}</h1>
      <ul>
        {jobs.map((j) => (
          <li key={j.id}>
            <a href={j.apply?.url ?? `https://i-jobs.remotehustle.name.ng/jobs/${j.id}`} target="_blank" rel="noopener">
              <strong>{j.title}</strong> · {j.company_name}
            </a>
            {j.score != null && <span> · {j.score}% match</span>}
            {/* Source rules: when source.credit is set, show it linked to source.url; use apply.url unchanged. */}
            {j.source?.credit && <small> · <a href={j.source.url ?? undefined} target="_blank" rel="noopener">{j.source.credit}</a></small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

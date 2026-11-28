// Copy partner-kit/ijobs.ts to lib/ijobs-client.ts in your site, then keep this file next to it.
import 'server-only'; // build fails if a browser component imports this (npm i server-only)
import { createIjobs } from './ijobs-client';

export const ijobs = createIjobs({
  siteKey: process.env.IJOBS_SITE_KEY!, // from i-jobs; set in Vercel → Settings → Environment Variables
  apiUrl: process.env.IJOBS_API_URL, // optional; defaults to the live API
});

/**
 * Link the signed-in user (cheap: call it on every visit to the job pages).
 * Replace `user` with however your site gets its signed-in user.
 */
export async function linkedUser(user: { id: string; email: string; emailVerified: boolean; name?: string; dateOfBirth?: string; finishedCourseIds?: string[] }) {
  const r = await ijobs.linkUser({
    external_user_id: user.id,
    email: user.email,
    email_verified: user.emailVerified,
    full_name: user.name,
    date_of_birth: user.dateOfBirth, // School1: needed so 13–17s get parent approval
    completed_trainings: user.finishedCourseIds,
  });
  return r.linked ? { me: ijobs.forUser(user.id), consentUrl: null } : { me: null, consentUrl: r.consent_url ?? null };
}

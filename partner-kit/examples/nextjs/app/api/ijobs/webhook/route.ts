// i-jobs tells your site when things happen: a new strong match, an application update, a CV read.
// Register this address once (see the README), and put the secret it gives you in IJOBS_WEBHOOK_SECRET.
import { verifyWebhook } from '@/lib/ijobs-client';

export async function POST(req: Request) {
  const raw = await req.text(); // the raw body: verify before parsing
  if (!verifyWebhook(raw, req.headers.get('x-ijobs-signature'), process.env.IJOBS_WEBHOOK_SECRET!)) {
    return new Response('bad signature', { status: 401 });
  }
  const event = JSON.parse(raw) as { id: string; type: string; site_user: string; data: any };

  // The same event can arrive twice: skip ids you've already handled (store them in your database).
  // if (await alreadyHandled(event.id)) return new Response('ok');

  switch (event.type) {
    case 'match.created': // data: { job_id, score } — e.g. notify event.site_user (your user id)
      break;
    case 'application.status_changed': // data: { application_id, status, … }
      break;
    case 'work.ready': // a CV read or apply pack finished: refresh that user's page
      break;
    case 'membership.updated':
      break;
  }
  return new Response('ok'); // answer within 10 seconds; do slow work in the background
}

import { redirect } from 'next/navigation';

/** Emails link to /owner; the dashboard lives in the app. */
export default function OwnerShortcut() {
  redirect('/app/owner');
}

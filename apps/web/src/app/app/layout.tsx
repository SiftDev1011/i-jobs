import { redirect } from 'next/navigation';
import { currentUser, engine } from '@/lib/engine';
import { AppShell } from './_shell/app-shell';

/** Everything under /app needs a signed-in person. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  if (!me) redirect('/sign-in?next=/app');
  const api = await engine();
  const unread = (await api.GET('/me/notifications', { params: { query: { unread: true, limit: 1 } } })).data?.unread_count ?? 0;
  const name = me.full_name?.trim() || me.email || me.phone || 'You';
  return <AppShell name={name} unread={unread} roles={{ owner: !!me.is_owner, employer: !!me.is_employer, staff: !!me.is_staff }}>{children}</AppShell>;
}

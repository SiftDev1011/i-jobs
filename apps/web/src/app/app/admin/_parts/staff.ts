import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/engine';
import { AREAS, can } from './roles';

/** The signed-in staff member's role, or a 404 for everyone else (staff pages don't advertise themselves). */
export const staffRole = cache(async () => {
  const me = await currentUser();
  if (!me?.is_staff || !me.staff_role) notFound();
  return me.staff_role;
});

/** Sends a staff member without access to this area to the first area they do have. */
export async function needs(href: (typeof AREAS)[number]['href']) {
  const role = await staffRole();
  if (!can(role, href)) redirect(AREAS.find((a) => (a.roles as readonly string[]).includes(role))?.href ?? '/app');
  return role;
}

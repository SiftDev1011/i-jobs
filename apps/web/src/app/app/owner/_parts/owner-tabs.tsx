'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import u from '../../_ui/ui.module.css';

const TABS = [
  ['', 'Overview'], ['/members', 'Members'], ['/invites', 'Invites'], ['/jobs', 'Jobs'], ['/earnings', 'Earnings'], ['/codes', 'Selar codes'], ['/settings', 'Settings'],
] as const;

export function OwnerTabs({ id }: { id: string }) {
  const path = usePathname();
  const root = `/app/owner/${id}`;
  return (
    <nav className={u.tabs} aria-label="Community">
      {TABS.map(([href, label]) => {
        const to = root + href;
        const on = href === '' ? path === root : path.startsWith(to);
        return <Link key={href} href={to} aria-current={on ? 'page' : undefined}>{label}</Link>;
      })}
    </nav>
  );
}

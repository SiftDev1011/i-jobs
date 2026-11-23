'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import u from '../../_ui/ui.module.css';
import { AREAS } from './roles';

export function AdminTabs({ role }: { role: string }) {
  const path = usePathname();
  return (
    <nav className={u.tabs} aria-label="Staff tools">
      {AREAS.filter((a) => (a.roles as readonly string[]).includes(role)).map((a) => {
        const on = a.href === '/app/admin' ? path === a.href : path.startsWith(a.href);
        return <Link key={a.href} href={a.href} aria-current={on ? 'page' : undefined}>{a.label}</Link>;
      })}
    </nav>
  );
}

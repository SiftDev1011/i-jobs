'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from '@/app/actions/auth';
import { NavIcon, type NavIconName } from './nav-icons';
import s from './shell.module.css';

const MAIN: { href: string; label: string; icon: NavIconName }[] = [
  { href: '/app', label: 'Home', icon: 'home' },
  { href: '/app/matches', label: 'Matches', icon: 'matches' },
  { href: '/app/queue', label: 'Apply queue', icon: 'queue' },
  { href: '/app/applications', label: 'Applications', icon: 'applications' },
  { href: '/app/profile', label: 'Profile & CV', icon: 'profile' },
  { href: '/app/autopilot', label: 'Autopilot', icon: 'autopilot' },
];
const MORE: { href: string; label: string; icon: NavIconName }[] = [
  { href: '/app/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/jobs', label: 'Browse all jobs', icon: 'search' },
  { href: '/app/help', label: 'Help', icon: 'help' },
  { href: '/app/settings', label: 'Settings & privacy', icon: 'settings' },
];
const TABS = ['/app', '/app/matches', '/app/applications', '/app/profile'];

export type Roles = { owner: boolean; employer: boolean; staff: boolean };

/** Areas for people who run a community, hire, or work at i-jobs. Each shows only to them. */
function workLinks(roles: Roles) {
  const out: { href: string; label: string; icon: NavIconName }[] = [];
  if (roles.owner) out.push({ href: '/app/owner', label: 'My community', icon: 'community' });
  if (roles.employer) out.push({ href: '/app/employer', label: 'Hiring', icon: 'briefcase' });
  if (roles.staff) out.push({ href: '/app/admin', label: 'Staff tools', icon: 'shield' });
  return out;
}

/** The signed-in app: sidebar on desktop, top bar and bottom tabs on phones. */
export function AppShell({ name, unread, roles, children }: { name: string; unread: number; roles: Roles; children: React.ReactNode }) {
  const WORK = workLinks(roles);
  const path = usePathname();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const active = (href: string) => (href === '/app' ? path === '/app' : path === href || path.startsWith(`${href}/`));

  const item = (l: { href: string; label: string; icon: NavIconName }) => (
    <Link key={l.href} href={l.href} className={`${s.item} ${active(l.href) ? s.on : ''}`} aria-current={active(l.href) ? 'page' : undefined}>
      <NavIcon name={l.icon} />
      <span>{l.label}</span>
      {l.icon === 'bell' && unread > 0 && <b className={s.count}>{unread > 99 ? '99+' : unread}</b>}
    </Link>
  );

  return (
    <div className={s.shell}>
      <aside className={s.side}>
        <Link href="/app" className={s.logo} aria-label="i-jobs home"><img src="/logo-header.png" alt="i-jobs" width={282} height={96} /></Link>
        <nav className={s.nav} aria-label="App">{MAIN.map(item)}</nav>
        {WORK.length > 0 && <nav className={`${s.nav} ${s.work}`} aria-label="Work">{WORK.map(item)}</nav>}
        <nav className={`${s.nav} ${s.lower}`} aria-label="More">{MORE.map(item)}</nav>
        <div className={s.me}>
          <span className={s.avatar} aria-hidden="true">{(name[0] ?? '?').toUpperCase()}</span>
          <span className={s.meName}>{name}</span>
          <form action={signOut}><button className={s.out} aria-label="Log out" title="Log out"><NavIcon name="logout" /></button></form>
        </div>
      </aside>

      <header className={s.top}>
        <Link href="/app" aria-label="i-jobs home"><img src="/logo-header.png" alt="i-jobs" width={282} height={96} className={s.topLogo} /></Link>
        <Link href="/app/notifications" className={s.bell} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <NavIcon name="bell" size={22} />{unread > 0 && <b className={s.dot} />}
        </Link>
      </header>

      <div className={s.content}>{children}</div>

      <nav className={s.tabs} aria-label="App">
        {MAIN.filter((l) => TABS.includes(l.href)).map((l) => (
          <Link key={l.href} href={l.href} className={`${s.tab} ${active(l.href) ? s.on : ''}`} aria-current={active(l.href) ? 'page' : undefined}>
            <NavIcon name={l.icon} size={22} /><span>{l.label === 'Profile & CV' ? 'Profile' : l.label}</span>
          </Link>
        ))}
        <button className={`${s.tab} ${more ? s.on : ''}`} onClick={() => setMore((v) => !v)} aria-expanded={more} aria-controls="more-sheet">
          <NavIcon name="more" size={22} /><span>More</span>
        </button>
      </nav>
      {more && (
        <div className={s.moreSheet} id="more-sheet" onClick={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className={s.morePanel}>
            {[...MAIN.filter((l) => !TABS.includes(l.href)), ...WORK, ...MORE].map(item)}
            <form action={signOut}><button className={s.item}><NavIcon name="logout" /><span>Log out</span></button></form>
          </div>
        </div>
      )}
    </div>
  );
}

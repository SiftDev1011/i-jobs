'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { openOnboard } from './onboard-button';
import s from './site-nav.module.css';

const LINKS = [
  { href: '/jobs', label: 'Find jobs' },
  { href: '/#join', label: 'How to get access' },
  { href: '/#communities', label: 'For communities' },
  { href: '/employers', label: 'For employers' },
  { href: '/help', label: 'Help' },
];

/**
 * The site nav. On the landing page (phones): only the logo, centred; on scroll it slides left
 * and the bar drops down with Onboard and the menu button. Desktop: logo, links, Log in, Onboard.
 * `solid` pages (everything but the landing page) start in the scrolled state.
 */
export function SiteNav({ signedIn, solid = false }: { signedIn: boolean; solid?: boolean }) {
  const [scrolled, setScrolled] = useState(solid);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (solid) return;
    const on = () => {
      const now = window.scrollY > 24;
      setScrolled(now);
      if (!now) setOpen(false);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [solid]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  return (
    <header className={`${s.nav} ${scrolled ? s.scrolled : ''}`}>
      <div className={s.bar} />
      <div className={s['nav-in']}>
        <Link className={s.brand} href="/" aria-label="i-jobs home">
          <img src="/logo-header.png" alt="i-jobs" width={282} height={96} />
        </Link>
        <nav className={s['nav-links']} aria-label="Main">
          {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        <div className={s['nav-end']}>
          {signedIn ? (
            <Link className="btn btn-green btn-sm" href="/app">Open i-jobs</Link>
          ) : (
            <>
              <Link className={`btn btn-sm ${s.login}`} href="/sign-in">Log in</Link>
              <button type="button" className="btn btn-green btn-sm" onClick={() => openOnboard('code')}>Onboard</button>
            </>
          )}
          <button type="button" className={s['menu-btn']} aria-label="Menu" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((v) => !v)}>
            <svg className={s['ic-lines']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            <svg className={s['ic-close']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>
      <div className={s.menu} id="site-menu" hidden={!open}>
        <div className="wrap">
          <nav aria-label="Main" onClick={() => setOpen(false)}>
            {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
            <Link href="/about">About i-jobs</Link>
          </nav>
          <div className={s.row}>
            {signedIn ? (
              <Link className="btn btn-green" href="/app">Open i-jobs</Link>
            ) : (
              <>
                <Link className="btn btn-line" href="/sign-in">Log in</Link>
                <button type="button" className="btn btn-green" onClick={() => { setOpen(false); openOnboard('code'); }}>Onboard</button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

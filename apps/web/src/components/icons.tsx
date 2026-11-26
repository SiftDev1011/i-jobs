/** The icon set from the landing page, as SVG symbols. Use with <Icon name="..." />. */
export type IconName = 'headset' | 'chart' | 'brush' | 'pen' | 'code' | 'cart' | 'cap' | 'cal' | 'video' | 'users' | 'calc' | 'globe' | 'brief' | 'laptop' | 'star' | 'msg' | 'shield' | 'flame' | 'check' | 'x' | 'pin' | 'clock';

export function Icons() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-headset" viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0116 0v2M4 14h3v5H5a1 1 0 01-1-1v-4zM20 14h-3v5h2a1 1 0 001-1v-4zM17 19c0 1.5-2 2-5 2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></symbol>
        <symbol id="i-brush" viewBox="0 0 24 24"><path d="M14 4l6 6-8 8-6-6 8-8zM6 12l-2 6 6-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-code" viewBox="0 0 24 24"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="i-cart" viewBox="0 0 24 24"><path d="M3 4h2l2.4 11h10.2L20 8H6.3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="19" r="1.6" fill="currentColor"/><circle cx="17" cy="19" r="1.6" fill="currentColor"/></symbol>
        <symbol id="i-cap" viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5L2 9zM6 11v5c3 2.5 9 2.5 12 0v-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M4 10h16M9 3v4M15 3v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></symbol>
        <symbol id="i-video" viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M16 10l5-3v10l-5-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 010 7M18 15c2 .6 3 2.3 3.5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></symbol>
        <symbol id="i-calc" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></symbol>
        <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="currentColor" strokeWidth="2"/></symbol>
        <symbol id="i-brief" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M9 7V5h6v2M3 13h18" fill="none" stroke="currentColor" strokeWidth="2.2"/></symbol>
        <symbol id="i-laptop" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M3 19h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></symbol>
        <symbol id="i-star" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-msg" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="i-flame" viewBox="0 0 24 24"><path d="M12 21c-3.9 0-7-2.7-7-6.5 0-3.4 2.6-5.6 4-8.5.7 2 2 3 3 3 0-2.5 1-4.5 3-6 0 3 4 5.5 4 11.5 0 3.8-3.1 6.5-7 6.5z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="2.2"/></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/></symbol>
      </defs>
    </svg>
  );
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

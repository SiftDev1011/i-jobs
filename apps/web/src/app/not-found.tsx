import Link from 'next/link';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';

export default function NotFound() {
  return (
    <div className="page">
      <SiteNav signedIn={false} solid />
      <main className="wrap" style={{ paddingBlock: '96px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>We couldn&rsquo;t find that page</h1>
        <p style={{ color: 'var(--ink-2)' }}>It may have moved, or the job may have closed.</p>
        <Link className="btn btn-green" href="/jobs">Browse jobs</Link>
      </main>
      <SiteFooter />
    </div>
  );
}

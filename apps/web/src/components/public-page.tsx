import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';

export async function isSignedIn() {
  const jar = await cookies();
  return !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
}

/** Nav, content and footer for the public pages (everything but the landing page and the app). */
export async function PublicPage({ children, className }: { children: React.ReactNode; className?: string }) {
  const signedIn = await isSignedIn();
  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className={`wrap ${className ?? ''}`}>{children}</main>
      <SiteFooter />
    </div>
  );
}

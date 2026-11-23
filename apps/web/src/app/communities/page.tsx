import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Icon } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine } from '@/lib/engine';
import { companyTile } from '@/lib/format';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import s from './communities.module.css';

export const metadata: Metadata = { title: 'Find a community' };

export default async function Communities({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const r = await (await engine({ anonymous: true })).GET('/communities', { params: { query: { q: q?.trim().slice(0, 80) || undefined, limit: 30 } } }).catch(() => null);
  const items = r?.data?.items ?? [];
  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className={`wrap ${s.main}`}>
        <h1 className={s.h}>Find a verified community</h1>
        <p className={s.lead}>i-jobs comes through job communities. Every one here is checked by our team. Already in a WhatsApp or Telegram job group? Ask the admin for their invite code.</p>
        <form className={s.search} action="/communities" role="search">
          <input className="input" name="q" defaultValue={q} placeholder="Lagos, design, graduates" aria-label="Search communities" />
          <button className="btn btn-green">Search</button>
        </form>
        {items.length === 0 ? <p className={s.empty}>{q ? 'No communities match that. Try a city or a skill.' : 'No communities to show yet.'}</p> : (
          <ul className={s.grid}>
            {items.map((c) => {
              const t = companyTile(c.name ?? '?');
              return (
                <li key={c.id}>
                  <Link className={s.card} href={`/join/${encodeURIComponent(c.slug ?? '')}`}>
                    <span className={`tile ${t.colour} ${s.tile}`}>{t.initials}</span>
                    <span className={s.text}><b>{c.name}</b><span>{c.member_count ?? 0} members</span></span>
                    {c.verified && <span className="badge b-green"><Icon name="shield" />Verified</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

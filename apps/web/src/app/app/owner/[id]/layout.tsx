import Link from 'next/link';
import { COMMUNITY_STATUS } from '@/lib/labels';
import { StatusChip } from '../../_parts/chip';
import u from '../../_ui/ui.module.css';
import { loadCommunity } from '../_parts/load';
import { OwnerTabs } from '../_parts/owner-tabs';

export default async function CommunityLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const c = await loadCommunity(id);
  return (
    <main className={`${u.page} ${u.wide}`}>
      <div className={u.head}>
        <div>
          <p className={u.crumb}><Link href="/app/owner">My community</Link></p>
          <h1 className={u.h1}>{c.name}</h1>
        </div>
        <StatusChip value={c.status} map={COMMUNITY_STATUS} />
      </div>
      <OwnerTabs id={id} />
      {children}
    </main>
  );
}

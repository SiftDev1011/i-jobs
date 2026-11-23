import Link from 'next/link';
import { redirect } from 'next/navigation';
import { engine, must } from '@/lib/engine';
import { COMMUNITY_STATUS } from '@/lib/labels';
import { StatusChip } from '../_parts/chip';
import u from '../_ui/ui.module.css';

export const metadata = { title: 'My community' };

/** One community goes straight to its dashboard; several get a list. */
export default async function OwnerHome() {
  const list = must(await (await engine()).GET('/owner/communities'));
  if (list.length === 1) redirect(`/app/owner/${list[0].id}`);
  return (
    <main className={u.page}>
      <div className={u.head}>
        <div>
          <h1 className={u.h1}>My community</h1>
          <p className={u.lead}>Run your WhatsApp or Telegram job group on i-jobs. Your members get matched and applied for; you see how they’re doing.</p>
        </div>
      </div>
      {list.length === 0 ? (
        <div className={u.empty}>
          <p>You don’t run a community on i-jobs yet.</p>
          <Link className="btn btn-green btn-sm" href="/owners/apply">Apply to run one</Link>
        </div>
      ) : (
        <ul className={u.list}>
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/app/owner/${c.id}`} className={`${u.card} ${u.row} ${u.between}`}>
                <span><b>{c.name}</b><br /><span className={u.muted}>/{c.slug} · code {c.invite_code}</span></span>
                <StatusChip value={c.status} map={COMMUNITY_STATUS} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

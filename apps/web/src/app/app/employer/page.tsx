import Link from 'next/link';
import { redirect } from 'next/navigation';
import { engine, must } from '@/lib/engine';
import { VERIFICATION } from '@/lib/labels';
import { StatusChip } from '../_parts/chip';
import u from '../_ui/ui.module.css';
import { VerifyFlow } from './_parts/verify-flow';

export const metadata = { title: 'Hiring' };

export default async function EmployerHome() {
  const mine = must(await (await engine()).GET('/employers/mine'));
  if (mine.length === 1) redirect(`/app/employer/${mine[0].id}`);
  return (
    <main className={u.page}>
      <div>
        <h1 className={u.h1}>Hiring on i-jobs</h1>
        <p className={u.lead}>Post remote jobs to people who have a profile, a CV and a reason to apply well. Verified companies’ jobs go live at once.</p>
      </div>
      {mine.length > 0 && (
        <ul className={u.list}>
          {mine.map((e) => (
            <li key={e.id}>
              <Link href={`/app/employer/${e.id}`} className={`${u.card} ${u.row} ${u.between}`}>
                <span><b>{e.name}</b><br /><span className={u.muted}>{e.domain}</span></span>
                <StatusChip value={e.verification} map={VERIFICATION} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section className={u.section}>
        <h2 className={u.h2}>{mine.length ? 'Add another company' : 'Verify your company'}</h2>
        <div className={u.card}><VerifyFlow /></div>
      </section>
    </main>
  );
}

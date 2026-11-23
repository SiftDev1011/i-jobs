import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser, engine, EngineError, must } from '@/lib/engine';
import u from '../../../_ui/ui.module.css';
import { JobForm } from '../../_parts/job-form';

export const metadata = { title: 'Post a job' };

export default async function PostJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d;
  try {
    d = must(await (await engine()).GET('/employers/{employerId}', { params: { path: { employerId: id } } }));
  } catch (e) {
    if (e instanceof EngineError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const me = await currentUser();
  const e = d.employer!;
  return (
    <main className={u.page}>
      <div>
        <p className={u.crumb}><Link href="/app/employer">Hiring</Link><span>/</span><Link href={`/app/employer/${id}`}>{e.name}</Link></p>
        <h1 className={u.h1}>Post a job</h1>
        <p className={u.lead}>{e.verification === 'verified' ? 'Your company is verified, so the job goes live as soon as you post it (unless something looks off).' : 'A person checks this job before it goes live, because your company is still being verified.'}</p>
      </div>
      <div className={u.card}><JobForm employerId={id} domain={e.domain ?? ''} myEmail={me?.email ?? null} /></div>
    </main>
  );
}

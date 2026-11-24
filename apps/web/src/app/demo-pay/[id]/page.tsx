import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PublicPage } from '@/components/public-page';
import { currentUser, engine, features, maybe } from '@/lib/engine';
import { amount } from '@/lib/format';
import p from '../../_public/public.module.css';
import { completeDemoPayment } from './actions';

export const metadata: Metadata = { title: 'Demo payment', robots: { index: false } };

/**
 * Stands in for Paga's checkout when the engine runs with fake payments (development and demos).
 * It never exists in production: the engine refuses the fake driver there, and this page 404s.
 */
export default async function DemoPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await features()).demo_payments) notFound();
  if (!(await currentUser())) redirect(`/sign-in?next=/demo-pay/${id}`);
  const pay = maybe(await (await engine()).GET('/payments/{paymentId}', { params: { path: { paymentId: id } } }));
  if (!pay) notFound();
  if (pay.status !== 'pending') redirect(`/payments/${id}`);
  const what = pay.purpose === 'code_batch' ? 'Selar codes' : 'Membership';
  const back = pay.purpose === 'code_batch' && pay.community ? `/app/owner/${pay.community.id}/codes` : '/app';

  return (
    <PublicPage className={p.main}>
      <div className={p.panel} style={{ margin: '0 auto', width: '100%' }}>
        <span className={p.kicker}>Demo checkout</span>
        <h1 className={p.h2}>Pay {amount(pay.amount)}</h1>
        <p className={p.lead}>
          {what}{pay.community ? ` · ${pay.community.name}` : ''}. This is a demo: no money moves. On the live site this step is Paga&rsquo;s payment page.
        </p>
        <form action={completeDemoPayment.bind(null, id)} className={p.ctas}>
          <button className="btn btn-green" type="submit">Pay (demo)</button>
          <Link className="btn btn-line" href={back}>Cancel</Link>
        </form>
      </div>
    </PublicPage>
  );
}

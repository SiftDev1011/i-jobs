import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PublicPage } from '@/components/public-page';
import { currentUser, engine, maybe } from '@/lib/engine';
import { amount } from '@/lib/format';
import p from '../../_public/public.module.css';
import { WaitForPayment } from './wait';

export const metadata: Metadata = { title: 'Payment', robots: { index: false } };

/** Where Paga sends people after paying. Only the payer can see it. */
export default async function Payment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!(await currentUser())) redirect(`/sign-in?next=/payments/${id}`);
  const pay = maybe(await (await engine()).GET('/payments/{paymentId}', { params: { path: { paymentId: id } } }));
  if (!pay) notFound();
  const codes = pay.purpose === 'code_batch';
  const next = codes && pay.community ? `/app/owner/${pay.community.id}/codes` : '/app';

  return (
    <PublicPage className={p.main}>
      <div className={p.panel} style={{ margin: '0 auto', width: '100%' }}>
        {pay.status === 'succeeded' ? (
          <>
            <span className={p.kicker}>Paid</span>
            <h1 className={p.h2}>{codes ? 'Your codes are ready' : `You’re in${pay.community ? ` — welcome to ${pay.community.name}` : ''}`}</h1>
            <p className={p.lead}>{amount(pay.amount)} received. {codes ? 'Download them as a CSV for Selar from your dashboard.' : 'Next: upload your CV so we can start matching you.'}</p>
            <div className={p.ctas}><Link className="btn btn-green" href={codes ? next : '/app/profile/cv'}>{codes ? 'Get the codes' : 'Upload your CV'}</Link>{!codes && <Link className="btn btn-line" href="/app">Go to your home page</Link>}</div>
          </>
        ) : pay.status === 'pending' ? (
          <>
            <span className={p.kicker}>Almost there</span>
            <h1 className={p.h2}>Checking your payment</h1>
            <WaitForPayment />
            <div><Link className="btn btn-line" href={next}>Go back</Link></div>
          </>
        ) : (
          <>
            <span className={p.kicker}>Not paid</span>
            <h1 className={p.h2}>{pay.status === 'failed' ? 'The payment didn’t go through' : 'This payment was reversed'}</h1>
            <p className={p.lead}>{pay.failed ?? 'No money was taken for this attempt.'} You can try again from your {codes ? 'dashboard' : 'home page'}. If you were charged, contact support and we’ll sort it out.</p>
            <div className={p.ctas}><Link className="btn btn-green" href={next}>Try again</Link><Link className="btn btn-line" href="/app/help">Contact support</Link></div>
          </>
        )}
      </div>
    </PublicPage>
  );
}

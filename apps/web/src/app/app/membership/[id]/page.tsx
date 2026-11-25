import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { startCheckout } from '@/app/actions/membership';
import { currentUser, engine, features, must } from '@/lib/engine';
import { money } from '@/lib/format';
import u from '../../_ui/ui.module.css';
import { TrialForm } from './trial-form';

export const metadata: Metadata = { title: 'Your membership' };

export default async function MembershipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await currentUser())!;
  const api = await engine();
  const m = must(await api.GET('/me/memberships')).find((x) => x.id === id);
  if (!m) notFound();
  const join = m.community.slug ? (await api.GET('/join/{code}', { params: { path: { code: m.community.slug } } })).data : null;
  const price = join?.price ? money(join.price.amount_minor, join.price.currency) : null;
  const { payments } = await features();
  const soon = <p className={u.notice}>Payments open soon. We&rsquo;re finishing our payment setup; check back in a few days.</p>;

  if (m.status === 'pending_approval') {
    return (
      <main className={u.page}>
        <h1 className={u.h1}>{m.community.name}</h1>
        <p className={u.notice}>The owner approves new members. We&rsquo;ll let you know as soon as you&rsquo;re in.</p>
        <Link className="btn btn-line btn-sm" href="/app">Back home</Link>
      </main>
    );
  }
  if (m.status === 'active' || m.status === 'trialing') {
    return (
      <main className={u.page}>
        <h1 className={u.h1}>{m.community.name}</h1>
        <p className={`${u.notice} ${u.good}`}>You&rsquo;re in{m.status === 'trialing' ? ' on your free week' : ''}{m.current_period_end ? ` until ${new Date(m.current_period_end).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos',  day: 'numeric', month: 'long' })}` : ''}.</p>
        {m.status === 'trialing' && payments && (
          <form action={startCheckout}><input type="hidden" name="membership" value={m.id} /><button className="btn btn-green">Pay now{price ? ` (${price})` : ''}</button></form>
        )}
        <Link className="btn btn-plain btn-sm" href="/app">Back home</Link>
      </main>
    );
  }

  return (
    <main className={u.page}>
      <div>
        <h1 className={u.h1}>Unlock i-jobs with {m.community.name}</h1>
        <p className={u.lead}>Your membership is shared between {m.community.name} and i-jobs.</p>
      </div>
      <div className={u.grid2}>
        <section className={u.card}>
          <h2 className={u.h2}>Pay your membership</h2>
          <p className={u.muted}>{price ? `${price} a month, paid securely through Paga (card, transfer or USSD).` : 'Paid securely through Paga (card, transfer or USSD).'}</p>
          {payments ? <form action={startCheckout}><input type="hidden" name="membership" value={m.id} /><button className="btn btn-green btn-block">Pay{price ? ` ${price}` : ''}</button></form> : soon}
        </section>
        {join?.trial_available && m.status === 'pending_payment' && (
          <section className={u.card}>
            <h2 className={u.h2}>Or try it free for a week</h2>
            <p className={u.muted}>One free week per person. We text your phone a code so it stays that way.</p>
            <TrialForm membershipId={m.id} phone={me.phone ?? ''} />
          </section>
        )}
      </div>
    </main>
  );
}

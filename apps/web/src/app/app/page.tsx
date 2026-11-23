import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser, engine, features, must } from '@/lib/engine';
import { companyTile } from '@/lib/format';
import { APPLICATION_STATUS } from '@/lib/labels';
import { GuardianForm } from './_parts/guardian-form';
import u from './_ui/ui.module.css';
import h from './home.module.css';

export const metadata: Metadata = { title: 'Home' };

const STEP_ORDER = ['joined', 'paid', 'cv_uploaded', 'rules_set', 'complete'] as const;
const STATUS: Record<string, string> = {
  pending_approval: 'Waiting for the owner to let you in',
  pending_payment: 'Pay or start your free week',
  trialing: 'Free week',
  active: 'Active',
  past_due: 'Payment due',
  expired: 'Ended',
  cancelled: 'Cancelled',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ joined?: string; linked?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  const api = await engine();
  const [memberships, f] = await Promise.all([api.GET('/me/memberships').then(must), features()]);
  const payStep = f.free_weeks ? 'Pay or start your free week' : 'Pay to unlock everything';
  const m = me.active_membership ?? memberships.find((x) => x.status === 'pending_payment' || x.status === 'pending_approval') ?? null;
  const open = !me.features_locked && (m?.status === 'active' || m?.status === 'trialing');

  const [profile, apps, matches, rules] = open
    ? await Promise.all([
        api.GET('/me/profile').then((r) => r.data ?? null),
        api.GET('/me/applications', { params: { query: { limit: 4 } } }).then((r) => r.data ?? null),
        api.GET('/me/matches', { params: { query: { status: ['new'], limit: 3 } } }).then((r) => r.data ?? null),
        api.GET('/me/autopilot').then((r) => r.data ?? null),
      ])
    : [null, null, null, null];

  const at = m ? STEP_ORDER.indexOf(m.onboarding_step) : -1;
  const steps = m ? [
    { label: 'Join a community', done: true, href: null },
    { label: m.status === 'pending_approval' ? 'Wait for the owner to let you in' : payStep, done: at >= 1 || m.status === 'active' || m.status === 'trialing', href: m.status === 'pending_payment' || m.status === 'past_due' ? `/app/membership/${m.id}` : null },
    { label: 'Upload your CV', done: at >= 2 || !!profile?.cv?.parsed_at, href: '/app/profile/cv' },
    { label: 'Check your profile', done: !!profile?.confirmed_at, href: '/app/profile' },
    { label: 'Set your autopilot rules', done: at >= 3 || !!rules?.enabled, href: '/app/autopilot' },
  ] : [];
  const left = steps.filter((s) => !s.done).length;
  const first = me.full_name?.split(' ')[0];

  return (
    <main className={u.page}>
      <div>
        <h1 className={u.h1}>{first ? `Hi ${first}` : 'Welcome to i-jobs'}</h1>
        <p className={u.lead}>{open ? 'Here’s what i-jobs did for you, and what’s next.' : 'A few steps and i-jobs starts working for you.'}</p>
      </div>

      {sp.joined && <p className={`${u.notice} ${u.good}`}>You&rsquo;ve joined. {f.free_weeks ? 'Pay or start your free week to unlock everything.' : 'Pay to unlock everything.'}</p>}
      {sp.linked && <p className={`${u.notice} ${u.good}`}>Your accounts are linked.</p>}

      {me.features_locked && (
        me.age_band === 'under_13' ? (
          <p className={u.notice}>i-jobs is for people 13 and over, so job features aren&rsquo;t available on this account.</p>
        ) : (
          <div className={u.card}>
            <h2 className={u.h2}>Ask a parent to approve your account</h2>
            <p className={u.muted}>You&rsquo;re under 18, so a parent or guardian needs to say yes before i-jobs can match or apply for you. We&rsquo;ll email them a link.</p>
            <GuardianForm />
          </div>
        )
      )}

      {!m ? (
        <div className={u.empty}>
          <p>You haven&rsquo;t joined a community yet. Get an invite code from your job community, or find a verified one.</p>
          <div className={u.row}><Link className="btn btn-green btn-sm" href="/communities">Find a community</Link></div>
        </div>
      ) : left > 0 ? (
        <section className={u.card}>
          <div className={`${u.row} ${u.between}`}>
            <h2 className={u.h2}>Get set up</h2>
            <span className={u.muted}>{steps.length - left} of {steps.length} done</span>
          </div>
          <div className={u.meter}><i style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
          <ol className={h.steps}>
            {steps.map((s, i) => (
              <li key={s.label} className={s.done ? h.done : ''}>
                <span className={h.n}>{s.done ? '✓' : i + 1}</span>
                {!s.done && s.href ? <Link href={s.href}>{s.label}</Link> : <span>{s.label}</span>}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {open && apps?.totals && (
        <section className={u.grid4} aria-label="Totals">
          <div className={u.stat}><span>Sent</span><b>{apps.totals.sent ?? 0}</b></div>
          <div className={u.stat}><span>Replies</span><b>{apps.totals.replies ?? 0}</b></div>
          <div className={u.stat}><span>Interviews</span><b>{apps.totals.interviews ?? 0}</b></div>
          <div className={u.stat}><span>In your queue</span><b>{apps.totals.in_queue ?? 0}</b></div>
        </section>
      )}

      {open && (
        <div className={u.grid2}>
          <section className={u.section}>
            <div className={`${u.row} ${u.between}`}><h2 className={u.h2}>New matches</h2><Link className="btn btn-plain btn-sm" href="/app/matches">See all</Link></div>
            {matches?.items?.length ? (
              <ul className={u.list}>
                {matches.items.map((x) => {
                  const t = companyTile(x.job.company_name);
                  return (
                    <li key={x.job.id}>
                      <Link href={`/app/jobs/${x.job.id}`} className={h.mini}>
                        <span className={`tile ${t.colour}`}>{t.initials}</span>
                        <span className={h.miniText}><b>{x.job.title}</b><span>{x.job.company_name}</span></span>
                        <span className={`${u.score} t-green`}>{x.score}%</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <p className={u.muted}>No new matches right now. New jobs arrive through the day.</p>}
          </section>
          <section className={u.section}>
            <div className={`${u.row} ${u.between}`}><h2 className={u.h2}>Latest applications</h2><Link className="btn btn-plain btn-sm" href="/app/applications">See all</Link></div>
            {apps?.items?.length ? (
              <ul className={u.list}>
                {apps.items.map((a) => {
                  const st = APPLICATION_STATUS[a.status] ?? { label: a.status, cls: 't-ink' };
                  return (
                    <li key={a.id}>
                      <Link href={`/app/applications/${a.id}`} className={h.mini}>
                        <span className={h.miniText}><b>{a.job.title}</b><span>{a.job.company_name}</span></span>
                        <span className={`${u.chip} ${st.cls}`}>{st.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <p className={u.muted}>Nothing sent yet. Turn on autopilot or apply from your matches.</p>}
          </section>
        </div>
      )}

      {memberships.length > 0 && (
        <section className={u.section}>
          <h2 className={u.h2}>Your communities</h2>
          <ul className={u.list}>
            {memberships.map((x) => (
              <li key={x.id} className={`${u.card} ${h.membership}`}>
                <div><b>{x.community.name}</b><p className={u.muted}>{STATUS[x.status] ?? x.status}{x.current_period_end && (x.status === 'active' || x.status === 'trialing') ? ` · until ${new Date(x.current_period_end).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos',  day: 'numeric', month: 'short' })}` : ''}</p></div>
                {(x.status === 'pending_payment' || x.status === 'past_due' || x.status === 'expired') && <Link className="btn btn-green btn-sm" href={`/app/membership/${x.id}`}>{x.status === 'pending_payment' ? 'Continue' : 'Renew'}</Link>}
                {x.switch_offer && <Link className="btn btn-line btn-sm" href="/communities">Switch community</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Icon } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { engine, EngineError, features, must } from '@/lib/engine';
import { companyTile, money } from '@/lib/format';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { JoinButton } from './join-button';
import s from './join.module.css';

type Params = { params: Promise<{ code: string }> };
const PERIOD = { monthly: 'a month', quarterly: 'every 3 months', yearly: 'a year' } as const;

async function load(code: string) {
  try {
    const api = await engine({ anonymous: true });
    return { page: must(await api.GET('/join/{code}', { params: { path: { code } } })), problem: null };
  } catch (e) {
    if (e instanceof EngineError && e.status === 404) return { page: null, problem: e.code };
    throw e;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { page } = await load(decodeURIComponent((await params).code)).catch(() => ({ page: null }));
  return { title: page?.community.name ? `Join ${page.community.name}` : 'Join a community', robots: { index: false } };
}

export default async function Join({ params }: Params) {
  const code = decodeURIComponent((await params).code).trim();
  const jar = await cookies();
  const signedIn = !!(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  const [{ page, problem }, f] = await Promise.all([load(code), features()]);

  if (!page) {
    return (
      <div className="page">
        <SiteNav signedIn={signedIn} solid />
        <main className={`wrap ${s.missing}`}>
          <h1>{problem === 'code_used' ? 'This code has already been used' : 'We couldn’t find that invite'}</h1>
          <p>Check the code or link with your community owner. Codes look like <b>LTH-2048</b>.</p>
          <Link className="btn btn-line" href="/communities">Find a verified community</Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const c = page.community;
  const tile = companyTile(c.name ?? '?');
  const prepaid = page.kind === 'access_code';
  const via = /^[a-z0-9-]+$/.test(code) && code === c.slug ? 'invite_link' : 'invite_code';

  return (
    <div className="page">
      <SiteNav signedIn={signedIn} solid />
      <main className={`wrap ${s.main}`}>
        <div className={s.card}>
          <div className={s.top}>
            <span className={`tile ${tile.colour} ${s.tile}`}>{tile.initials}</span>
            <div className={s.id}>
              <h1>{c.name}</h1>
              <p>{c.member_count ?? 0} members</p>
            </div>
            {c.verified && <span className="badge b-green"><Icon name="shield" />Verified</span>}
          </div>
          {c.description && <p className={s.desc}>{c.description}</p>}
          <dl className={s.facts}>
            <div><dt>Membership</dt><dd>{prepaid ? 'Already paid with your code' : page.price ? `${money(page.price.amount_minor, page.price.currency)} ${PERIOD[page.billing_period ?? 'monthly']}` : 'Set by your community'}</dd></div>
            {!prepaid && f.free_weeks && <div><dt>Free week</dt><dd>{page.trial_available ? 'Available' : 'Not offered'}</dd></div>}
            {page.approval_required && <div><dt>Joining</dt><dd>The owner approves new members</dd></div>}
          </dl>
          <ul className={s.gets}>
            {['Matches to your CV every day', 'Autopilot applies inside your rules', 'Every reply tracked in one place'].map((g) => (
              <li key={g}><Icon name="check" />{g}</li>
            ))}
          </ul>
          {signedIn ? (
            <JoinButton code={code} via={via} label={prepaid ? 'Activate my access' : `Join ${c.name}`} />
          ) : (
            <Link className="btn btn-green btn-block" href={`/sign-in?next=${encodeURIComponent(`/join/${code}`)}`}>Continue</Link>
          )}
          <p className="hint">{signedIn ? (page.trial_available ? 'You can pay or start your free week on the next step.' : 'You can pay on the next step.') : `Log in or sign up with your ${f.phone_sign_in ? 'email or phone number' : 'email'} first. It takes a minute.`}</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

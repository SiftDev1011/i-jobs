import type { Metadata } from 'next';
import Link from 'next/link';
import { engine, maybe } from '@/lib/engine';
import u from '../_ui/ui.module.css';
import { ConfirmButton } from './confirm-button';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile & CV' };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const { fresh } = await searchParams;
  const profile = maybe(await (await engine()).GET('/me/profile'));

  if (!profile) {
    return (
      <main className={u.page}>
        <h1 className={u.h1}>Your profile</h1>
        <div className={u.empty}>
          <p>Start with your CV. We turn it into a profile you can check and correct.</p>
          <Link className="btn btn-green btn-sm" href="/app/profile/cv">Upload your CV</Link>
        </div>
      </main>
    );
  }

  const strength = profile.strength ?? 0;
  return (
    <main className={u.page}>
      <div className={u.head}>
        <div>
          <h1 className={u.h1}>Your profile</h1>
          <p className={u.lead}>This is what i-jobs matches and applies with. Fix anything we got wrong.</p>
        </div>
        <Link className="btn btn-line btn-sm" href="/app/profile/cv">{profile.cv?.uploaded ? 'Upload a new CV' : 'Upload your CV'}</Link>
      </div>

      {fresh && <p className={`${u.notice} ${u.good}`}>We read your CV. Check everything below, then confirm it&rsquo;s right.</p>}
      {(profile.needs_confirmation || !profile.confirmed_at) && (
        <div className={`${u.notice} ${u.info} ${u.row} ${u.between}`}>
          <span>{profile.confirmed_at ? 'It’s been a while. Is your profile still right? Autopilot pauses after 90 days without a check.' : 'Check your profile, then confirm it’s accurate. Autopilot only sends once you have.'}</span>
          <ConfirmButton />
        </div>
      )}

      <section className={u.card}>
        <div className={`${u.row} ${u.between}`}><h2 className={u.h2}>Profile strength</h2><b>{strength}%</b></div>
        <div className={u.meter}><i style={{ width: `${strength}%` }} /></div>
        {profile.strength_tips?.length ? <ul className={u.muted} style={{ margin: 0, paddingLeft: 18 }}>{profile.strength_tips.map((t) => <li key={t}>{t}</li>)}</ul> : null}
      </section>

      <ProfileForm profile={profile} />
    </main>
  );
}

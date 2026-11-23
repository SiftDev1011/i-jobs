import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteNav } from '@/components/site-nav';
import { currentUser, features } from '@/lib/engine';
import { safeNext } from '@/lib/session';
import { SignInForm } from './sign-in-form';
import s from './sign-in.module.css';

export const metadata: Metadata = { title: 'Log in' };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = safeNext(next);
  if (await currentUser().catch(() => null)) redirect(dest);
  const f = await features();
  return (
    <div className="page">
      <SiteNav signedIn={false} solid />
      <main className={s.main}>
        <div className={s.card}>
          <h1 className={s.h}>Log in or sign up</h1>
          <p className={s.sub}>We&rsquo;ll send you a 6-digit code. No password to remember.</p>
          <SignInForm next={dest} phone={f.phone_sign_in} />
        </div>
      </main>
    </div>
  );
}

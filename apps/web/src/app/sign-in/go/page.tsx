import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/session';

/**
 * Signed-out visits to app pages are sent here by the middleware (as a rewrite), then on to
 * /sign-in with the page they asked for. Redirecting from a page keeps the address relative, so
 * it works behind proxies (GitHub Codespaces) where the app thinks its host is localhost.
 */
export default async function GoSignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  redirect(`/sign-in?next=${encodeURIComponent(safeNext(next))}`);
}

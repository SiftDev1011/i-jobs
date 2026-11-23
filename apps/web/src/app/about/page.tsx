import type { Metadata } from 'next';
import { PublicPage } from '@/components/public-page';
import { contentPage } from '@/lib/markdown';
import p from '../_public/public.module.css';

export const metadata: Metadata = { title: 'About i-jobs' };

/** Rendered from content/about.md. Edit that file to change this page. */
export default async function Page() {
  const { html, draft } = await contentPage('about');
  return (
    <PublicPage className={p.main}>
      <article className={p.prose}>
        {draft && <p className={p.draft} role="note">{draft}</p>}
        <div className={p.prose} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </PublicPage>
  );
}

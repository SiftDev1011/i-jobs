import type { Metadata } from 'next';
import Link from 'next/link';
import { engine } from '@/lib/engine';
import u from '../../_ui/ui.module.css';
import { CvUpload } from './cv-upload';

export const metadata: Metadata = { title: 'Upload your CV' };

export default async function CvPage() {
  const api = await engine();
  const [r, consents] = await Promise.all([api.GET('/me/profile'), api.GET('/me/consents')]);
  const parsedAt = r.data?.cv?.parsed_at ?? null;
  const consented = !!consents.data?.find((c) => c.purpose === 'matching')?.granted;
  return (
    <main className={u.page}>
      <div>
        <p className={u.small}><Link href="/app/profile">Profile</Link> / CV</p>
        <h1 className={u.h1}>{parsedAt ? 'Upload a new CV' : 'Upload your CV'}</h1>
        <p className={u.lead}>We read it into your profile: your skills, experience and education. You check it over before anything is sent.</p>
      </div>
      <CvUpload parsedAt={parsedAt} consented={consented} />
      <div className={`${u.card} ${u.soft}`}>
        <h2 className={u.h2}>Tips for a CV we can read well</h2>
        <ul className={u.muted} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>A PDF saved from Word or Google Docs works best. Photos or scans are harder to read.</li>
          <li>Keep it under 5 MB and 4 pages.</li>
          <li>List your skills and tools by name (Excel, Zendesk, Figma).</li>
        </ul>
      </div>
    </main>
  );
}

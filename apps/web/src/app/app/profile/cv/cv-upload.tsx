'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { cvParse, cvParsedAt, cvUploadLink, setConsent } from '@/app/actions/member';
import u from '../../_ui/ui.module.css';
import s from './cv.module.css';

type Stage = 'idle' | 'uploading' | 'reading' | 'later' | 'error';
const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Uploads straight to storage with the signed link, asks the engine to read it, waits for the profile. */
export function CvUpload({ parsedAt, consented }: { parsedAt: string | null; consented: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [agreed, setAgreed] = useState(consented);

  async function handle(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    if (!agreed) { setStage('error'); setMessage('Tick the box to let i-jobs read your CV first.'); return; }
    setStage('uploading');
    if (!consented) {
      const c = await setConsent('matching', true);
      if (!c.ok) { setStage('error'); setMessage(c.error); return; }
    }
    const link = await cvUploadLink({ name: file.name, type: file.type, size: file.size });
    if (!link.ok) { setStage('error'); setMessage(link.error); return; }
    let put: Response;
    try {
      put = await fetch(link.data!.upload_url, { method: 'PUT', body: file, headers: { 'content-type': file.type } });
    } catch (e) {
      // No answer at all: the connection dropped, or storage didn't allow this site (CORS).
      console.error('CV upload: no response from storage', e);
      setStage('error'); setMessage('The upload didn’t finish. Check your connection and try again. (No response from storage.)'); return;
    }
    if (!put.ok) {
      console.error('CV upload: storage refused the file', put.status, await put.text().catch(() => ''));
      setStage('error'); setMessage(`Our file storage turned the upload away (error ${put.status}). Try again in a moment; if it keeps happening, tell us.`); return;
    }
    setStage('reading');
    const work = await cvParse(link.data!.upload_id);
    if (!work.ok) { setStage('error'); setMessage(work.error); return; }
    if (work.data?.status === 'scheduled') {
      setStage('later');
      setMessage('We’ve used today’s reading budget. Your CV is saved and we’ll read it first thing tomorrow. We’ll email you when your profile is ready.');
      return;
    }
    // Wait for the profile to be rebuilt (usually under a minute).
    const started = Date.now();
    while (Date.now() - started < 3 * 60_000) {
      await new Promise((r) => setTimeout(r, 3000));
      const at = await cvParsedAt().catch(() => null);
      if (at && at !== parsedAt) { router.push('/app/profile?fresh=1'); router.refresh(); return; }
    }
    setStage('later');
    setMessage('Reading is taking longer than usual. We’ll email you when your profile is ready, or if we couldn’t read the file.');
  }

  const busy = stage === 'uploading' || stage === 'reading';
  return (
    <div
      className={`${s.drop} ${over ? s.over : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) handle(e.dataTransfer.files[0]); }}
    >
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => handle(e.target.files?.[0])} />
      {busy ? (
        <>
          <span className={s.spinner} aria-hidden="true" />
          <p className={s.big}>{stage === 'uploading' ? 'Uploading your CV…' : 'Reading your CV…'}</p>
          <p className={u.muted}>{stage === 'reading' ? 'This usually takes under a minute. You can leave this page; we’ll email you.' : 'Keep this page open.'}</p>
        </>
      ) : (
        <>
          <p className={s.big}>Drop your CV here</p>
          <p className={u.muted}>PDF or Word (.docx), up to 5 MB</p>
          {!consented && (
            <label className={s.consent}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I agree that i-jobs reads my CV and uses my profile to match me to jobs.</span>
            </label>
          )}
          <button className="btn btn-green" disabled={!agreed} onClick={() => input.current?.click()}>Choose a file</button>
        </>
      )}
      {message && <p className={stage === 'error' ? 'err' : `${u.notice} ${u.info}`} role="status">{message}</p>}
    </div>
  );
}

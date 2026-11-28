'use client';
// The browser sends the file straight to i-jobs' storage; your server only asks for the link.
// Your site's address must be in the R2 bucket's CORS rules (see the README).
import { useState } from 'react';

const TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export function CvUpload() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function onFile(file: File) {
    if (!TYPES.includes(file.type)) { setState('error'); setMsg('Upload a PDF or Word (.docx) file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setState('error'); setMsg('That file is over 5 MB.'); return; }
    setState('busy');
    const post = (body: object) => fetch('/api/ijobs/cv', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const link = await post({ step: 'link', file_name: file.name, content_type: file.type, size_bytes: file.size });
    if (!link.ok) { setState('error'); setMsg((await link.json()).title ?? 'Try again.'); return; }
    const { upload_id, upload_url } = await link.json();
    const put = await fetch(upload_url, { method: 'PUT', body: file, headers: { 'content-type': file.type } }).catch(() => null);
    if (!put?.ok) { setState('error'); setMsg('The upload didn’t finish. Try again.'); return; }
    const parsed = await post({ step: 'parse', upload_id });
    if (!parsed.ok) { setState('error'); setMsg((await parsed.json()).title ?? 'Try again.'); return; }
    setState('done');
    setMsg('Got it. We’re reading your CV; your matches appear here shortly.');
  }

  return (
    <div>
      <input type="file" accept=".pdf,.docx" disabled={state === 'busy'} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {state === 'busy' && <p>Uploading…</p>}
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}

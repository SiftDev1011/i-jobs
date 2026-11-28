// POST { step: "link", file_name, content_type, size_bytes } → { upload_id, upload_url }
// POST { step: "parse", upload_id }                          → i-jobs reads the CV
import { NextResponse } from 'next/server';
import { getSignedInUser } from '@/lib/auth'; // ← your own auth
import { IjobsError } from '@/lib/ijobs-client';
import { linkedUser } from '@/lib/ijobs';

export async function POST(req: Request) {
  const user = await getSignedInUser();
  if (!user) return NextResponse.json({ title: 'Sign in first' }, { status: 401 });
  const { me } = await linkedUser(user);
  if (!me) return NextResponse.json({ title: 'Connect your i-jobs account first' }, { status: 409 });
  const body = await req.json();
  try {
    if (body.step === 'link') {
      const link = await me.cvUploadLink({ file_name: String(body.file_name), content_type: body.content_type, size_bytes: Number(body.size_bytes) });
      return NextResponse.json({ upload_id: link.upload_id, upload_url: link.upload_url });
    }
    if (body.step === 'parse') return NextResponse.json(await me.parseCv(String(body.upload_id)), { status: 202 });
    return NextResponse.json({ title: 'Unknown step' }, { status: 400 });
  } catch (e) {
    if (e instanceof IjobsError) return NextResponse.json({ code: e.code, title: e.title }, { status: e.status || 502 });
    throw e;
  }
}

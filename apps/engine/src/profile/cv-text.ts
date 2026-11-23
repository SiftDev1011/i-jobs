import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tidy } from '../ingest/text';

export const CV_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export class CvUnreadable extends Error {
  constructor(readonly reason: 'wrong_type' | 'no_text' | 'too_big' | 'broken', message: string) {
    super(message);
  }
}

/**
 * Plain text from a CV. PDFs go through poppler's pdftotext in a separate process with a time
 * limit (it's maintained by the OS's security updates and handles odd PDFs well); Word files
 * through mammoth. The file's first bytes decide the type, never its name.
 */
export async function cvText(bytes: Buffer, opts: { pdftotext: string; timeoutMs?: number }): Promise<string> {
  if (bytes.length > 5 * 1024 * 1024) throw new CvUnreadable('too_big', 'The CV is larger than 5 MB');
  let text: string;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    text = await pdfText(bytes, opts.pdftotext, opts.timeoutMs ?? 20_000);
  } else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // .docx is a zip file.
    const mammoth = await import('mammoth');
    try {
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } catch {
      throw new CvUnreadable('broken', 'This Word file could not be opened');
    }
  } else {
    throw new CvUnreadable('wrong_type', 'Upload a PDF or a Word (.docx) file');
  }
  const clean = tidy(text.replace(/\u0000/g, ''));
  if (clean.replace(/\s/g, '').length < 100) {
    throw new CvUnreadable('no_text', 'We could not read text in this CV. If it is a scan or a photo, upload a PDF made from a document instead.');
  }
  return clean;
}

async function pdfText(bytes: Buffer, bin: string, timeoutMs: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cv-'));
  const file = join(dir, 'cv.pdf');
  try {
    await writeFile(file, bytes, { mode: 0o600 });
    return await new Promise<string>((resolve, reject) => {
      execFile(
        bin,
        ['-layout', '-enc', 'UTF-8', '-l', '10', '-q', file, '-'],
        { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' },
        (err, stdout) => (err ? reject(new CvUnreadable('broken', 'This PDF could not be read')) : resolve(stdout)),
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import { randomBytes } from 'node:crypto';

export interface Attachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MimeMessage {
  from: { name: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
  messageId?: string;
  headers?: Record<string, string>;
}

/** RFC 2047 for non-ASCII header words (names, subjects). */
export function encodeWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const safeHeader = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const quotedName = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, '')}"` : encodeWord(s));

/** A small MIME writer: plain text plus attachments, base64 everywhere, CRLF line ends. */
export function buildMime(m: MimeMessage): string {
  const boundary = `ij_${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${quotedName(safeHeader(m.from.name))} <${m.from.address}>`,
    `To: ${safeHeader(m.to)}`,
    ...(m.replyTo ? [`Reply-To: ${safeHeader(m.replyTo)}`] : []),
    `Subject: ${encodeWord(safeHeader(m.subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    ...(m.messageId ? [`Message-ID: ${m.messageId}`] : []),
    'MIME-Version: 1.0',
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${safeHeader(v)}`),
  ];
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(m.text, 'utf8').toString('base64'))];

  if (!m.attachments?.length) return [...headers, ...textPart].join('\r\n') + '\r\n';

  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...textPart,
  ];
  for (const a of m.attachments) {
    const name = encodeWord(safeHeader(a.filename).replace(/"/g, ''));
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrap76(a.content.toString('base64')),
    );
  }
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

/** Employer replies: plain text out of a raw email, and a first sort by rules before any AI. */

export type ReplyClass = 'interview' | 'rejection' | 'info_request' | 'auto_reply' | 'other';

const AUTO_SUBJECT = /^(auto(matic)?[ -]?(reply|response)|out of (the )?office|ooo\b|away from|automatic reply|delivery status)|thank(s| you) for (your )?(application|applying|interest)/i;
const AUTO_BODY = /\b(this is an automated (message|response|email)|do not reply to this (email|message)|we have received your application and (will|our team will))\b/i;
const REJECTION = /\b(unfortunately|regret to inform|not (be )?(moving|proceeding) forward|decided (to move forward|to proceed) with other|(have|has) not been selected|not been successful|position has (now )?been filled|we will not be (progressing|moving)|other candidates whose)/i;
const INTERVIEW = /\b(interview|schedule (a|an) (call|chat|meeting|video call)|your availability|calendly\.com|cal\.com\/|book a (time|slot|call)|(next|following) (step|stage|round)|assessment|take-home|test task|meet (the|our) team)\b/i;
const INFO = /\b(could you (please )?(send|share|provide|confirm|tell)|please (send|share|provide|confirm|complete)|can you (send|share|provide)|salary expectations?|notice period|your portfolio|answer the following|fill (in|out) (this|the) form)\b/i;

/** Rules are sure about most replies; the rest go to the AI (or stay "other"). */
export function sortByRules(subject: string, text: string): ReplyClass | null {
  const body = text.slice(0, 4000);
  if (AUTO_SUBJECT.test(subject) || AUTO_BODY.test(body)) return REJECTION.test(body) ? 'rejection' : 'auto_reply';
  if (REJECTION.test(body)) return 'rejection';
  if (INTERVIEW.test(subject) || INTERVIEW.test(body)) return 'interview';
  if (INFO.test(body)) return 'info_request';
  return null;
}

/** Statuses only move forward; a later "other" never undoes an interview. */
const RANK: Record<string, number> = { sent: 1, no_response: 1, replied: 2, interview: 3, offer: 4, hired: 5, rejected: 6 };
export function nextStatus(current: string, reply: ReplyClass): string | null {
  const target = reply === 'interview' ? 'interview' : reply === 'rejection' ? 'rejected' : reply === 'auto_reply' ? null : 'replied';
  if (!target) return null;
  if (current === 'rejected' || current === 'hired') return null;
  return (RANK[target] ?? 0) > (RANK[current] ?? 0) ? target : null;
}

/** Text from a raw message: the text/plain part (decoded), else HTML stripped. Quoted history removed. */
export function textFromRaw(raw: string): string {
  const { headers, body } = split(raw);
  const type = header(headers, 'content-type') ?? 'text/plain';
  let text: string | null = null;
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    const parts = body.split(`--${boundary}`).slice(1, -1).map(split);
    const plain = parts.find((p) => /^text\/plain/i.test(header(p.headers, 'content-type') ?? ''));
    const html = parts.find((p) => /^text\/html/i.test(header(p.headers, 'content-type') ?? ''));
    const nested = parts.find((p) => /^multipart\//i.test(header(p.headers, 'content-type') ?? ''));
    if (plain) text = decode(plain.body, header(plain.headers, 'content-transfer-encoding'));
    else if (nested) return textFromRaw(`${nested.headers}\r\n\r\n${nested.body}`);
    else if (html) text = stripHtml(decode(html.body, header(html.headers, 'content-transfer-encoding')));
  } else {
    text = decode(body, header(headers, 'content-transfer-encoding'));
    if (/^text\/html/i.test(type)) text = stripHtml(text);
  }
  return withoutQuotes(text ?? '');
}

export function withoutQuotes(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{5,200}wrote:\s*$/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^From: .+/.test(line) && out.length > 2) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
}

function split(part: string): { headers: string; body: string } {
  const i = part.search(/\r?\n\r?\n/);
  return i < 0 ? { headers: part, body: '' } : { headers: part.slice(0, i), body: part.slice(i).replace(/^\r?\n\r?\n/, '') };
}

function header(headers: string, name: string): string | null {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  const m = new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(unfolded);
  return m ? m[1].trim() : null;
}

function decode(body: string, encoding: string | null): string {
  const enc = (encoding ?? '').toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc === 'quoted-printable') {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

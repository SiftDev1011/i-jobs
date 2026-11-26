/** Small, dependency-free text helpers for job descriptions from many sources. */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', euro: '€', pound: '£',
  copy: '©', reg: '®', trade: '™', times: '×', laquo: '«', raquo: '»', shy: '', zwj: '', zwnj: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * HTML to readable plain text: keeps paragraphs and list items, drops scripts and styles.
 * Handles double-escaped HTML (Greenhouse sends `&lt;p&gt;`).
 */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section|article|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return tidy(s);
}

/** Collapse spaces, keep at most one blank line between paragraphs. */
export function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v  -​  　]+/g, ' ')
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function oneLine(s: string | null | undefined, max = 300): string {
  const t = tidy(decodeEntities(String(s ?? ''))).replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** First sentence-ish chunk, for summaries when no AI is used. */
export function firstWords(s: string, maxChars = 240): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > maxChars * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
export function findEmails(s: string): string[] {
  return [...new Set((s.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/\.$/, '')))];
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
export function findUrls(s: string): string[] {
  return [...new Set((s.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Only http(s) links are ever stored or shown. */
/** A company logo address we can show: https only, sensible length. */
export function logoUrl(url: unknown): string | null {
  const u = typeof url === 'string' ? safeUrl(url) : null;
  return u && u.startsWith('https://') && u.length <= 1000 ? u : null;
}

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(String(url).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Parse many date shapes: ISO strings, epoch seconds or milliseconds, RFC 2822. */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  let d: Date;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{9,13}$/.test(v))) {
    const n = Number(v);
    d = new Date(n < 1e11 ? n * 1000 : n);
  } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) {
    d = new Date(`${v.replace(' ', 'T')}Z`);
  } else {
    d = new Date(String(v));
  }
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? d : null;
}

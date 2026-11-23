import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A small Markdown subset for the content pages (about, privacy, terms): headings (#, ##, ###) with
 * optional {#id}, paragraphs, - and 1. lists, **bold**, *italic* and [links](url). Text is escaped
 * first, so the files can't inject HTML. Lines starting with "> DRAFT" render as a draft notice.
 */
export function renderMarkdown(src: string): { html: string; title: string | null; draft: string | null } {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#|mailto:)[^)\s]*)\)/g, (_, t, u) => `<a href="${u}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${t}</a>`);
  let title: string | null = null;
  let draft: string | null = null;
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const d = /^>\s*DRAFT[:\s]*(.*)$/i.exec(line);
    if (d) { draft = d[1] || 'This is placeholder text.'; continue; }
    const h = /^(#{1,3})\s+(.+?)(?:\s*\{#([a-z0-9-]+)\})?$/.exec(line);
    const li = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (h) {
      flush(); close();
      const level = h[1].length;
      if (level === 1 && !title) title = h[2];
      out.push(`<h${level}${h[3] ? ` id="${h[3]}"` : ''}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      flush();
      const kind = li[1] ? 'ul' : 'ol';
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[3])}</li>`);
    } else if (!line.trim()) {
      flush(); close();
    } else {
      close();
      para.push(line.trim());
    }
  }
  flush(); close();
  return { html: out.join('\n'), title, draft };
}

/** Reads content/<name>.md from the web app folder. */
export async function contentPage(name: 'about' | 'privacy' | 'terms') {
  const file = path.join(process.cwd(), 'content', `${name}.md`);
  return renderMarkdown(await readFile(file, 'utf8'));
}

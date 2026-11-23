import { describe, expect, it } from './runner';
import { renderMarkdown } from '../src/lib/markdown';
import { dateLabel } from '../src/lib/format';

describe('content pages', () => {
  it('renders headings with anchors, lists, emphasis and safe links', () => {
    const { html, title, draft } = renderMarkdown('> DRAFT: replace me\n# Terms\n\n## Owners {#owners}\n- Only **real** jobs\n- See [help](/help) or [site](https://x.example)\n\n1. one\n2. two\n\nPlain *text* here.');
    expect(title).toBe('Terms');
    expect(draft).toBe('replace me');
    expect(html).toContain('<h2 id="owners">Owners</h2>');
    expect(html).toContain('<ul>\n<li>Only <strong>real</strong> jobs</li>');
    expect(html).toContain('<a href="/help">help</a>');
    expect(html).toContain('<a href="https://x.example" target="_blank" rel="noopener noreferrer">site</a>');
    expect(html).toContain('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
    expect(html).toContain('<p>Plain <em>text</em> here.</p>');
  });

  it('never lets the file inject HTML or script links', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('dates', () => {
  it('shows Lagos dates', () => {
    expect(dateLabel('2026-11-20T23:30:00Z')).toBe('21 Nov 2026');
    expect(dateLabel(null)).toBe('—');
  });
});

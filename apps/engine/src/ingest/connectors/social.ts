/**
 * Free-text sources: posts and comments. A cheap code filter drops anything that isn't
 * a job post before it reaches the AI, because the AI budget only covers ~66 a day.
 */
import { findEmails, findUrls, htmlToText, safeUrl, toDate } from '../text';
import { cfg, Connector } from '../types';

const JOBBY = /\b(hiring|we['’]re hiring|job opening|open role|now hiring|vacancy|vacancies|position|apply|looking for an? )\b/i;

// ------------------------------------------------------------------ Bluesky
// searchPosts on the public AppView, or signed in with an app password when provided.
export const bluesky: Connector = {
  key: 'bluesky',
  async fetch({ http, source, config }) {
    let base = 'https://public.api.bsky.app';
    const headers: Record<string, string> = {};
    if (config.BLUESKY_HANDLE && config.BLUESKY_APP_PASSWORD) {
      const session = await http.json('https://bsky.social/xrpc/com.atproto.server.createSession', {
        json: { identifier: config.BLUESKY_HANDLE, password: config.BLUESKY_APP_PASSWORD },
        retries: 0,
      });
      base = 'https://bsky.social';
      headers.Authorization = `Bearer ${session.accessJwt}`;
    }
    const items = [];
    for (const q of cfg<string[]>(source, 'queries', ['#hiring remote'])) {
      const res = await http.json(
        `${base}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=${cfg(source, 'limit', 50)}&sort=latest`,
        { headers },
      );
      items.push(...(res.posts ?? []).map((p: any) => ({ externalId: p.uri, url: postUrl(p), payload: p })));
    }
    return { items, complete: false };
  },
  normalise(p) {
    const text: string = p.record?.text ?? '';
    const links = [
      ...(p.record?.facets ?? []).flatMap((f: any) => (f.features ?? []).map((x: any) => x.uri)).filter(Boolean),
      p.record?.embed?.external?.uri,
      ...findUrls(text),
    ].map(safeUrl).filter((u): u is string => !!u);
    const emails = findEmails(text);
    if (!JOBBY.test(text)) return { skip: 'not_a_job_post' };
    if (!links.length && !emails.length) return { skip: 'no_way_to_apply' };
    const embed = p.record?.embed?.external;
    return {
      title: '',
      company: p.author?.displayName || p.author?.handle || '',
      description: [text, embed ? `${embed.title ?? ''}\n${embed.description ?? ''}` : ''].filter(Boolean).join('\n\n').trim(),
      sourceUrl: postUrl(p),
      applyUrl: links[0] ?? null,
      applyEmail: emails[0] ?? null,
      location: {},
      postedAt: toDate(p.record?.createdAt ?? p.indexedAt),
      needsAi: true,
    };
  },
};

function postUrl(p: any): string | null {
  const rkey = String(p.uri ?? '').split('/').pop();
  return p.author?.handle && rkey ? `https://bsky.app/profile/${p.author.handle}/post/${rkey}` : null;
}

// ------------------------------------------------------------------ Hacker News "Who is hiring?"
// The latest monthly thread from the whoishiring account, read through the Algolia HN API.
export const hackernews: Connector = {
  key: 'hackernews',
  async fetch({ http, source }) {
    const search = await http.json('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10');
    const thread = (search.hits ?? []).find((h: any) => /who is hiring\?/i.test(h.title ?? ''));
    if (!thread) return { items: [], complete: false };
    const tree = await http.json(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(thread.objectID)}`);
    const max = cfg(source, 'max_comments', 400);
    const comments = (tree.children ?? []).filter((c: any) => c.text && c.author).slice(0, max);
    return {
      items: comments.map((c: any) => ({
        externalId: String(c.id),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        payload: { id: c.id, author: c.author, text: c.text, created_at: c.created_at, thread: thread.title },
      })),
      // Old threads drop out of this fetch each month; expiry closes their jobs instead.
      complete: false,
    };
  },
  normalise(c) {
    const text = htmlToText(c.text);
    // Comments follow "Company | Role | Location | REMOTE | ...". Keep remote ones and any for Africa.
    if (!/\bremote\b/i.test(text) && !/\b(nigeria|africa|lagos|emea|worldwide|anywhere)\b/i.test(text)) return { skip: 'hn_not_remote' };
    const firstLine = text.split('\n')[0];
    const company = firstLine.includes('|') ? firstLine.split('|')[0].trim().slice(0, 120) : '';
    return {
      title: '',
      company,
      description: text,
      sourceUrl: `https://news.ycombinator.com/item?id=${c.id}`,
      applyUrl: findUrls(text).map(safeUrl).find(Boolean) ?? null,
      applyEmail: findEmails(text)[0] ?? null,
      location: {},
      postedAt: toDate(c.created_at),
      needsAi: true,
    };
  },
};

export const socialConnectors = [bluesky, hackernews];

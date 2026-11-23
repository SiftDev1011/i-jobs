import { Problem } from './problem';

/**
 * Opaque cursors for "load more" paging. A cursor holds the sort key of the
 * last row seen, so pages stay stable while new rows arrive.
 */
export interface CursorKey {
  at: string; // ISO timestamp or sortable value
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor?: string | null): CursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.at === 'string' && typeof parsed?.id === 'string') return parsed;
  } catch {
    /* fall through */
  }
  throw Problem.badRequest('invalid_cursor', 'This page link is no longer valid. Start from the first page.');
}

/** Builds { items, next_cursor } from a query that fetched limit + 1 rows. */
export function page<T>(rows: T[], limit: number, keyOf: (row: T) => CursorKey) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, next_cursor: hasMore ? encodeCursor(keyOf(items[items.length - 1])) : null };
}

import type { AppConfig } from '../config/config';
import type { Http } from './http';
import type { LocationHints } from './location';
import type { Pay } from './normalise';

export interface SourceRow {
  key: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  excluded_origins: string[];
  default_expiry_days: number;
  apply_via_source_link: boolean;
  needs_ai_extraction: boolean;
}

export interface BoardRow {
  id: string;
  board_token: string;
  company_name: string | null;
}

export interface FetchContext {
  source: SourceRow;
  board: BoardRow | null;
  http: Http;
  config: AppConfig;
  /** External ids we already hold for this source/board, so connectors can skip detail calls. */
  known: Set<string>;
}

export interface RawItem {
  externalId: string;
  url?: string | null;
  payload: unknown;
  /** Already known and unchanged as far as the list shows: only mark it as still there. */
  touchOnly?: boolean;
}

export interface FetchResult {
  items: RawItem[];
  /**
   * True when the source returned its whole listing, so anything we hold that wasn't in it
   * has closed. False for searches, pages and feeds that only show the newest jobs.
   */
  complete: boolean;
}

/** What a connector can say about one posting, in our terms. */
export interface NormalisedJob {
  title: string;
  company: string;
  companyDomain?: string | null;
  /** Plain text. */
  description: string;
  /** The posting's page on the source (for credit and link-back). */
  sourceUrl: string | null;
  /** Where to apply, if different from the source page. */
  applyUrl?: string | null;
  applyEmail?: string | null;
  location: LocationHints;
  employmentHints?: (string | null | undefined)[];
  seniorityHint?: string | string[] | null;
  pay?: Pay | null;
  postedAt?: Date | null;
  deadline?: Date | null;
  labels?: (string | null | undefined)[];
  skills?: string[];
  /** Hosts the job originally came from (TheirStack passes on other boards' jobs). */
  originHosts?: string[];
  /** Free text only (social posts, HN comments): needs AI to pull out the fields. */
  needsAi?: boolean;
}

export interface Connector {
  key: string;
  /** Fed through our own API (pasted jobs), never fetched. */
  internal?: boolean;
  /** Fetched once per company board (Greenhouse, Lever...) instead of once per source. */
  perBoard?: boolean;
  /** Returns a message when credentials are missing; the run is skipped, not failed. */
  missingCredentials?: (config: AppConfig) => string | null;
  fetch(ctx: FetchContext): Promise<FetchResult>;
  /** null means "not a job we can use" (filtered out, with the reason recorded). */
  normalise(payload: any, ctx: { source: SourceRow; board: BoardRow | null }): NormalisedJob | { skip: string };
}

export class ConnectorUnavailable extends Error {}

export function isSkip(v: NormalisedJob | { skip: string }): v is { skip: string } {
  return 'skip' in v;
}

/** Read a typed setting from a source's config with a default. */
export function cfg<T>(source: SourceRow, key: string, fallback: T): T {
  const v = source.config?.[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

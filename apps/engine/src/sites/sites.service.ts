import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { sha256Hex } from '../common/crypto';
import { Db } from '../db/db.service';

export interface Site {
  id: string;
  slug: string;
  name: string;
  free_apply_limit: number;
  allows_minors: boolean;
  requires_community: boolean;
}

/**
 * Partner sites. Site keys are stored as SHA-256 hashes; issue one with
 * `npm run site-key -- <slug>` (see scripts/site-key.ts).
 */
@Injectable()
export class SitesService {
  private cache = new Map<string, { site: Site | null; at: number }>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  static hashKey(key: string): string {
    return sha256Hex(key);
  }

  async byKey(key: string): Promise<Site | null> {
    return this.cached(`key:${key}`, () =>
      this.db.k
        .selectFrom('sites')
        .select(['id', 'slug', 'name', 'free_apply_limit', 'allows_minors', 'requires_community'])
        .where('api_key_hash', '=', SitesService.hashKey(key))
        .executeTakeFirst(),
    );
  }

  async bySlug(slug: string): Promise<Site | null> {
    return this.cached(`slug:${slug}`, () =>
      this.db.k
        .selectFrom('sites')
        .select(['id', 'slug', 'name', 'free_apply_limit', 'allows_minors', 'requires_community'])
        .where('slug', '=', slug)
        .executeTakeFirst(),
    );
  }

  /** The i-jobs app's own site, used for people who sign in directly. */
  async ijobs(): Promise<Site> {
    const site = await this.bySlug(this.config.IJOBS_SITE_SLUG);
    if (!site) throw new Error(`Site "${this.config.IJOBS_SITE_SLUG}" is missing. Run the seed.`);
    return site;
  }

  clearCache() {
    this.cache.clear();
  }

  private async cached(key: string, load: () => Promise<Site | undefined>): Promise<Site | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.site;
    const site = (await load()) ?? null;
    this.cache.set(key, { site, at: Date.now() });
    return site;
  }
}

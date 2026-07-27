/**
 * `nextlySitemap` — build the default export for a Next `app/sitemap.ts` from a
 * caller-supplied entry provider, cached with F1 so a content write busts it.
 *
 * The provider is where you wire your data — e.g. `@nextlyhq/plugin-seo`'s
 * `buildSitemapUrls`, mapping each `{ loc }` to `{ url }`. Keeping the data
 * caller-supplied lets `nextly` stay independent of the plugin while the plugin
 * owns the agnostic source of truth. The `next` import is type-only.
 *
 * @module runtime/routing/sitemap
 */
import type { MetadataRoute } from "next";

import { cachedFind } from "../cache/cached-find";

/** A sitemap entry (a superset-compatible slice of Next's `MetadataRoute.Sitemap`). */
export interface NextlySitemapEntry {
  url: string;
  lastModified?: string | Date;
  changeFrequency?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
  alternates?: { languages?: Record<string, string> };
}

/** Options for {@link nextlySitemap}. */
export interface NextlySitemapOptions {
  /** Provide the sitemap entries (typically from the SEO plugin's data). */
  entries: () => Promise<NextlySitemapEntry[]> | NextlySitemapEntry[];
  /**
   * F1 cache tags for the read, so a content write busts the sitemap in lockstep
   * with the pages — use `nextlyTags(collection)` for each configured collection.
   */
  tags?: string[];
  /** Cache key parts (default a single stable key). */
  keyParts?: string[];
  /** Time-based revalidation seconds (safety net on top of tag busting). */
  revalidate?: number | false;
}

/**
 * Create the `app/sitemap.ts` default export.
 *
 * @example
 * ```ts
 * // app/sitemap.ts
 * import { nextlySitemap, nextlyTags } from "nextly/runtime";
 * import { buildSitemapUrls } from "@nextlyhq/plugin-seo";
 *
 * export default nextlySitemap({
 *   entries: async () => {
 *     const urls = await buildSitemapUrls(services, { collections: ["posts"], baseUrl });
 *     return urls.map(u => ({ url: u.loc, lastModified: u.lastModified }));
 *   },
 *   tags: nextlyTags("posts"),
 * });
 * ```
 */
export function nextlySitemap(
  options: NextlySitemapOptions
): () => Promise<MetadataRoute.Sitemap> {
  return () =>
    cachedFind(async () => normalize(await options.entries()), {
      tags: options.tags ?? [],
      keyParts: options.keyParts ?? ["nextly", "sitemap"],
      revalidate: options.revalidate ?? false,
    });
}

/** Map entries to Next's sitemap shape, dropping ones without a URL. */
function normalize(entries: NextlySitemapEntry[]): MetadataRoute.Sitemap {
  const sitemap: MetadataRoute.Sitemap = [];
  for (const entry of entries) {
    if (typeof entry.url !== "string" || entry.url === "") continue;
    sitemap.push({
      url: entry.url,
      ...(entry.lastModified !== undefined
        ? { lastModified: entry.lastModified }
        : {}),
      ...(entry.changeFrequency !== undefined
        ? { changeFrequency: entry.changeFrequency }
        : {}),
      ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
      ...(entry.alternates !== undefined
        ? { alternates: entry.alternates }
        : {}),
    });
  }
  return sitemap;
}

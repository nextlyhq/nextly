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
import { createRequire } from "node:module";

import type { MetadataRoute } from "next";

import { cachedFind } from "../cache/cached-find";

// `next/cache` is resolved lazily (opaque to bundlers) so importing this module
// never forces `next` at load. `unstable_noStore()` opts the current render out
// of Next's Data/Full Route Cache, which is what keeps an uncached sitemap from
// being frozen as a build-time prerender.
let cachedNoStore: (() => void) | null | undefined;
function markDynamic(): void {
  if (cachedNoStore === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("next/cache") as { unstable_noStore?: () => void };
      cachedNoStore =
        typeof mod.unstable_noStore === "function"
          ? mod.unstable_noStore
          : null;
    } catch {
      cachedNoStore = null;
    }
  }
  cachedNoStore?.();
}

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
  /**
   * Cache key parts. Defaults to `["nextly", "sitemap", ...tags]`, which keeps
   * sitemaps with distinct tags apart. Multiple sitemap helpers that share the
   * SAME tags (e.g. partitioned routes over the same collections) MUST pass
   * distinct `keyParts` — the `entries` provider lives in a closure and the
   * route pathname is not part of Next's cache key, so there is no automatic
   * way to tell two same-tagged providers apart.
   */
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
  const hasTags = (options.tags?.length ?? 0) > 0;
  // Only a POSITIVE window is a valid cache lifetime — `unstable_cache` rejects
  // `revalidate: 0` (Next requires `false` or `> 0`), so treat 0 as no window.
  const revalidate =
    typeof options.revalidate === "number" && options.revalidate > 0
      ? options.revalidate
      : false;
  // With neither invalidation tags nor a revalidate window, a cached entry would
  // pin the first render forever — publishes, edits, and deletes would never
  // reach `/sitemap.xml`. Mark the render dynamic (so Next doesn't freeze it as
  // a build-time prerender either) and read uncached so it always stays current.
  if (!hasTags && revalidate === false) {
    return async () => {
      markDynamic();
      return normalize(await options.entries());
    };
  }
  // Default the key off the tags so multiple sitemap helpers (partitioned or
  // nested) that omit `keyParts` don't alias to one shared cache entry.
  const keyParts = options.keyParts ?? [
    "nextly",
    "sitemap",
    ...(options.tags ?? []),
  ];
  return () =>
    cachedFind(async () => normalize(await options.entries()), {
      tags: options.tags ?? [],
      keyParts,
      revalidate,
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

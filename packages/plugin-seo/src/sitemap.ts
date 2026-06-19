/**
 * Sitemap generation for `@nextlyhq/plugin-seo`.
 *
 * Lists each target collection's PUBLISHED entries through the secure managed
 * service (D56 `where` + `depth:0`, as system — sitemaps are public derived
 * data) and renders a sitemaps.org `<urlset>`. Pure given a services object, so
 * it is unit-testable with a stub and integration-testable against a real boot.
 */
import type { SeoPluginOptions } from "./plugin";
import { defaultUrlFor } from "./plugin";

/** The slice of `ctx.services` the sitemap builder needs. */
export interface SitemapServices {
  collections: {
    listEntries(
      slug: string,
      query: {
        where?: Record<string, unknown>;
        depth?: number;
        pagination?: { limit?: number };
      },
      opts: { as: "system" }
    ): Promise<{ data: Array<Record<string, unknown>> }>;
  };
}

/** XML-escape a text value for safe inclusion in `<loc>`. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toLastmod(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Build the sitemap XML for the configured collections (published entries only).
 */
export async function generateSitemap(
  services: SitemapServices,
  opts: SeoPluginOptions
): Promise<string> {
  const urlFor = opts.urlFor ?? defaultUrlFor;
  const urls: string[] = [];

  for (const collection of opts.collections) {
    const result = await services.collections.listEntries(
      collection,
      {
        where: { status: { equals: "published" } },
        depth: 0,
        pagination: { limit: 1000 },
      },
      { as: "system" }
    );

    for (const entry of result.data) {
      const loc = escapeXml(`${opts.baseUrl}${urlFor(entry, collection)}`);
      const lastmod = toLastmod(entry.updatedAt);
      urls.push(
        `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

/** Lazily-generated, cached sitemap. Invalidated on collection change events. */
export interface SitemapCache {
  /** Return the cached sitemap, generating it on first access (or after invalidate). */
  get(services: SitemapServices): Promise<string>;
  /** Drop the cached sitemap so the next `get` regenerates. */
  invalidate(): void;
}

/** Create a per-plugin sitemap cache (one closure per `seo()` instance). */
export function createSitemapCache(opts: SeoPluginOptions): SitemapCache {
  let cached: string | null = null;
  return {
    async get(services) {
      if (cached === null) cached = await generateSitemap(services, opts);
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}

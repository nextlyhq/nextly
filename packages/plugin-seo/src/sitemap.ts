/**
 * Sitemap generation for `@nextlyhq/plugin-seo`.
 *
 * Framework-agnostic (zero `next`): lists each configured collection's
 * PUBLISHED entries through the managed service (as system — a sitemap is
 * public derived data) and renders a sitemaps.org `<urlset>`. Pure given a
 * services object, so it is unit-testable with a stub and integration-testable
 * against a real boot.
 *
 * Caching lives in the delivery layer, not here: the `<loc>` set is derived
 * from `status: published` content, which the F1 write path already busts on
 * every create / update / publish / delete, so a cached read tagged with the
 * collection tags refreshes on content changes without any bespoke cache.
 *
 * @module sitemap
 */
/**
 * The minimal `listEntries` the sitemap builder calls — a structural slice of
 * the managed collection service (`ctx.services.collections`). Declared
 * explicitly (rather than `Pick<PluginCollectionService, ...>`) so a test can
 * satisfy it with a plain stub, while the real, richer service stays assignable
 * to it. Reads published rows as system; only the fields the sitemap consumes
 * (`data` + `pagination.hasMore`) are named here.
 */
export interface SitemapServices {
  collections: {
    /**
     * Collection metadata — read only to check the built-in draft/published
     * lifecycle flag (`status: true`). Typed as `unknown` and narrowed at the
     * call site (the core `Collection` type does not surface `status`). The
     * context arg is unused by the read; pass `{}`.
     */
    getCollection(
      slug: string,
      context: Record<string, never>
    ): Promise<unknown>;
    listEntries(
      slug: string,
      query: {
        where?: Record<string, unknown>;
        depth?: number;
        // A stable, unique sort so consecutive pages don't overlap or skip
        // rows: the managed service adds `ORDER BY` only when `sort` is passed.
        sort?: { field: string; direction: "asc" | "desc" };
        // Paged by 1-indexed `page`: the managed service reads a page from
        // `page`, not `offset`, so pagination MUST advance `page` to progress.
        pagination?: { limit?: number; page?: number };
      },
      opts: { as: "system" }
    ): Promise<{ data: unknown[]; pagination: { hasMore: boolean } }>;
  };
}

/** One resolved sitemap URL. */
export interface SitemapUrl {
  /** Absolute location; XML-escaped at serialization time. */
  loc: string;
  /** ISO-8601 last-modified timestamp, when the entry carries one. */
  lastModified?: string;
}

/**
 * Build the URL path for an entry (leading slash, appended to the origin).
 * Defaults to `/<collection>/<slug>`. Return `null`/`undefined` to EXCLUDE the
 * entry from the sitemap (e.g. it has no stable public URL).
 */
export type UrlForEntry = (
  entry: Record<string, unknown>,
  collection: string
) => string | null | undefined;

/** Options for {@link buildSitemapUrls} / {@link generateSitemap}. */
export interface SitemapOptions {
  /** Collections whose published entries appear in the sitemap. */
  collections: string[];
  /**
   * Absolute site origin for `<loc>` (e.g. "https://example.com"). A trailing
   * slash is trimmed so a leading-slash path never produces a doubled `//`.
   */
  baseUrl: string;
  /** Path builder; defaults to `/<collection>/<slug>`. */
  urlFor?: UrlForEntry;
  /**
   * Page size for the paginated service reads. Defaults to and is capped at
   * {@link MAX_PAGE_SIZE} (the managed service's per-page maximum).
   */
  pageSize?: number;
}

/**
 * Default path: `/<collection>/<slug>`. Returns `null` when the entry has no
 * usable `slug` so the caller SKIPS it — without a slug there is no stable URL,
 * and emitting `/<collection>/` for every slugless row would advertise
 * duplicate, meaningless listing URLs.
 */
export function defaultUrlForEntry(
  entry: Record<string, unknown>,
  collection: string
): string | null {
  const slug = typeof entry.slug === "string" ? entry.slug.trim() : "";
  if (!slug) return null;
  // Percent-encode the slug so a value with spaces or non-ASCII characters is
  // still a valid URL path segment (`<loc>` must be a valid URL, and XML
  // escaping alone does not make ` ` or `é` URL-safe). The collection segment
  // is a fixed, already-safe config slug.
  return `/${collection}/${encodeURIComponent(slug)}`;
}

/** XML-escape a text value for safe inclusion in an element body. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Narrow an unknown row to an indexable object without asserting a type. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize a stored timestamp to ISO-8601, or undefined when unusable. */
function toLastModified(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The managed service caps a page at 500 rows and drops a larger `limit`, so a
 * page never exceeds this — the pagination loop relies on the requested size
 * matching what comes back to know when to stop.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * List every configured collection's PUBLISHED entries and map them to sitemap
 * URLs. Reads as system (a sitemap is public derived data), and pages through
 * ALL matches by advancing the 1-indexed `page` — no silent cap — so a large
 * collection is never truncated to a first-page slice. Entries flagged
 * `seo.noindex` are excluded: a page told not to be indexed does not belong in
 * the sitemap.
 *
 * The `status: published` filter is applied ONLY to collections with the
 * built-in draft/published lifecycle (`status: true`, read via
 * `getCollection`). A status-less collection has no unpublished state, so every
 * entry — all of which are live — is listed; the filter is skipped there rather
 * than applied to a same-named ordinary field. That mirrors the core's own
 * status handling (filter only when the lifecycle column exists).
 */
export async function buildSitemapUrls(
  services: SitemapServices,
  options: SitemapOptions
): Promise<SitemapUrl[]> {
  const urlFor = options.urlFor ?? defaultUrlForEntry;
  const pageSize =
    options.pageSize && options.pageSize > 0
      ? Math.min(options.pageSize, MAX_PAGE_SIZE)
      : MAX_PAGE_SIZE;
  // Trim a trailing slash so `${baseUrl}${"/path"}` never yields `//path`.
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const urls: SitemapUrl[] = [];

  for (const collection of options.collections) {
    // Apply the published filter ONLY to collections with the built-in
    // lifecycle. A status-less collection has no unpublished state, and it may
    // even define an ordinary `status` field (e.g. "active"/"closed"), so a
    // blanket `status = published` filter there would wrongly drop live rows.
    const meta = await services.collections.getCollection(collection, {});
    const hasLifecycle = isRecord(meta) && meta.status === true;
    const where = hasLifecycle
      ? { status: { equals: "published" } }
      : undefined;

    // 1-indexed: the managed service reads by `page`, not `offset`, so the loop
    // MUST advance `page` — advancing an ignored `offset` would re-read page 1
    // forever while `hasMore` stayed true.
    let page = 1;
    for (;;) {
      const result = await services.collections.listEntries(
        collection,
        {
          where,
          depth: 0,
          // Deterministic paging: without an explicit sort the service pages an
          // unordered query, so rows could repeat or vanish between pages. `id`
          // is unique and stable on every collection.
          sort: { field: "id", direction: "asc" },
          pagination: { limit: pageSize, page },
        },
        { as: "system" }
      );

      for (const row of result.data) {
        if (!isRecord(row)) continue;
        const seo = isRecord(row.seo) ? row.seo : undefined;
        // A noindexed page is intentionally kept out of the sitemap.
        if (seo?.noindex === true) continue;
        // Honor a declared canonical: a sitemap should list canonical URLs, so
        // when the entry sets one, advertise THAT rather than the generated URL
        // it points away from. The `canonical` field is free text, so resolve it
        // against `baseUrl` (a relative `/about` becomes absolute) and fall back
        // to the generated URL if it is not a usable URL — a `<loc>` must be a
        // valid absolute URL.
        const canonical =
          typeof seo?.canonical === "string" ? seo.canonical.trim() : "";
        let loc: string | null = null;
        if (canonical) {
          try {
            const resolved = new URL(canonical, baseUrl);
            // Only http(s) URLs are crawlable sitemap locations — a syntactically
            // valid `mailto:` / `javascript:` / `data:` value must not become a
            // `<loc>`; fall through to the generated URL instead.
            if (
              resolved.protocol === "http:" ||
              resolved.protocol === "https:"
            ) {
              loc = resolved.href;
            }
          } catch {
            loc = null;
          }
        }
        if (loc === null) {
          // A falsy path means the entry has no stable URL (no slug, or a
          // custom urlFor opted it out) — skip it rather than emit a bogus loc.
          const path = urlFor(row, collection);
          if (!path) continue;
          loc = `${baseUrl}${path}`;
        }
        urls.push({ loc, lastModified: toLastModified(row.updatedAt) });
      }

      if (!result.pagination.hasMore) break;
      page += 1;
    }
  }

  return urls;
}

/** Serialize resolved URLs into a sitemaps.org `<urlset>` document. */
export function serializeSitemap(urls: SitemapUrl[]): string {
  const body = urls
    .map(({ loc, lastModified }) => {
      const lastmod = lastModified
        ? `<lastmod>${escapeXml(lastModified)}</lastmod>`
        : "";
      return `  <url><loc>${escapeXml(loc)}</loc>${lastmod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

/** Build the full sitemap XML for the configured collections. */
export async function generateSitemap(
  services: SitemapServices,
  options: SitemapOptions
): Promise<string> {
  return serializeSitemap(await buildSitemapUrls(services, options));
}

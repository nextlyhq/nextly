/**
 * Reserved-path denylist — the paths a content catch-all must NOT serve, so
 * content can never be minted at a URL that shadows the admin panel, the API,
 * Next internals, or a well-known metadata file.
 *
 * @module runtime/routing/reserved-paths
 */

/** Path prefixes owned by the framework/admin — a content path under any is refused. */
const RESERVED_PREFIXES = ["/admin", "/api", "/_next", "/static"] as const;

/** Exact well-known files that must resolve to their own handlers, not content. */
const RESERVED_EXACT = new Set([
  "/sitemap.xml",
  "/robots.txt",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/opengraph-image",
  "/twitter-image",
]);

/**
 * Whether `path` is reserved (owned by the framework/admin/metadata) and must
 * not be served as content. Accepts a path with or without a leading slash;
 * a trailing slash is ignored.
 */
export function isReservedPath(path: string): boolean {
  let normalized = path.startsWith("/") ? path : `/${path}`;
  // Drop a trailing slash (but keep the root "/").
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (RESERVED_EXACT.has(normalized)) return true;
  return RESERVED_PREFIXES.some(
    prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

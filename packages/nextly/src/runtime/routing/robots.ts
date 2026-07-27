/**
 * `nextlyRobots` — build the default export for a Next `app/robots.ts` that
 * disallows the framework paths (`/admin`, `/api`) and points crawlers at the
 * sitemap. The `next` import is type-only.
 *
 * @module runtime/routing/robots
 */
import type { MetadataRoute } from "next";

/** Options for {@link nextlyRobots}. */
export interface NextlyRobotsOptions {
  /** Absolute sitemap URL(s) to advertise (e.g. `"https://example.com/sitemap.xml"`). */
  sitemap?: string | string[];
  /** User-agent the rule applies to (default `"*"`). */
  userAgent?: string;
  /** Extra disallowed paths, merged with the defaults (`/admin`, `/api`). */
  disallow?: string[];
  /** Allowed paths (takes precedence over a broader disallow). */
  allow?: string[];
  /** Preferred host for canonicalization. */
  host?: string;
}

/**
 * Create the `app/robots.ts` default export.
 *
 * @example
 * ```ts
 * // app/robots.ts
 * import { nextlyRobots } from "nextly/runtime";
 * export default nextlyRobots({ sitemap: "https://example.com/sitemap.xml" });
 * ```
 */
export function nextlyRobots(
  options: NextlyRobotsOptions = {}
): () => MetadataRoute.Robots {
  // Keep the admin panel and API out of the index; a caller can disallow more.
  const disallow = [
    ...new Set(["/admin", "/api", ...(options.disallow ?? [])]),
  ];
  return () => ({
    rules: {
      userAgent: options.userAgent ?? "*",
      ...(options.allow && options.allow.length > 0
        ? { allow: options.allow }
        : {}),
      disallow,
    },
    ...(options.sitemap ? { sitemap: options.sitemap } : {}),
    ...(options.host ? { host: options.host } : {}),
  });
}

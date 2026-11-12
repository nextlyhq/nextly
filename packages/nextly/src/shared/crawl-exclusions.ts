/**
 * The paths every crawler is asked to keep out of on a Nextly site: the
 * admin and the API, on a path boundary rather than as a raw prefix. The
 * trailing-slash form (`/admin/`) covers the whole subtree on every crawler,
 * the `$`-anchored form (`/admin$`) pins the bare root where a crawler reads
 * it, and the `?` form (`/admin?`) covers the root with a query
 * (`/admin?next=/x`). None takes similarly named content such as
 * `/administration`, which the router does serve.
 *
 * One list for every robots.txt a site is served, whichever writes it, so a
 * correction reaches all of them.
 *
 * @module shared/crawl-exclusions
 * @experimental
 */
export const FRAMEWORK_CRAWL_EXCLUSIONS: readonly string[] = [
  "/admin/",
  "/admin$",
  "/admin?",
  "/api/",
  "/api$",
  "/api?",
];

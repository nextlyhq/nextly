/**
 * How a plugin's package name becomes the identifier the admin addresses it by.
 *
 * Its own module, with no imports, for the same reason as the category
 * vocabulary: `admin-meta.ts` reaches the client-config validator and the
 * collection-slug helpers, and a browser bundle that only needs to turn
 * `"@acme/p"` into `"acme-p"` must not pull those in.
 *
 * @module nextly/plugins/plugin-slug
 */

/**
 * Derive a plugin's admin slug from its name (e.g. `"@acme/p"` → `"acme-p"`).
 *
 * Used server-side to look up host `pluginOverrides` and to namespace plugin
 * admin routes, and client-side to address the same plugin in a URL. Both
 * sides must agree: a table row linking to a slug the router derives
 * differently is a dead link, so there is one implementation and both import
 * it.
 *
 * Lower-case, collapse every non-alphanumeric run to a single dash, then trim
 * leading and trailing dashes. Idempotent, so a slug fed back in is unchanged.
 */
export function pluginAdminSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

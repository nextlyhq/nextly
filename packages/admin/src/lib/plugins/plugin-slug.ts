/**
 * Derive a plugin's admin slug from its package name.
 *
 * `"@acme/p"` becomes `"acme-p"`. One implementation for the whole admin, so
 * a table row and the router cannot disagree about where a plugin lives.
 *
 * The algorithm mirrors `pluginAdminSlug` in core, which derives the same slug
 * server-side for a different consumer (host `pluginOverrides` lookups and
 * plugin admin route namespacing). The two cannot share a module without the
 * admin importing a core internal, so the case table in `plugin-slug.test.ts`
 * is what keeps them honest: it is the contract, and it fails on either side
 * drifting.
 *
 * @module lib/plugins/plugin-slug
 */

/** Lower-case, collapse every non-alphanumeric run to a dash, trim dashes. */
export function pluginSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

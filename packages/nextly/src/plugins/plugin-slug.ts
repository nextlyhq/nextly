/**
 * How a plugin's package name becomes the identifier the admin addresses it by.
 *
 * Its own module, importing nothing but a type, for the same reason as the
 * category vocabulary: `admin-meta.ts` reaches the client-config validator and the
 * collection-slug helpers, and a browser bundle that only needs to turn
 * `"@acme/p"` into `"acme-p"` must not pull those in.
 *
 * @module nextly/plugins/plugin-slug
 */
import type { PluginDefinition } from "./plugin-context";

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

/**
 * Whether a name lies in a plugin's own namespace: it begins with the plugin's
 * slug and a dot, as `acme-billing.charged` does for `@acme/billing`.
 *
 * The one rule for every name a plugin publishes for others to hear or hook —
 * its hook points and its events — so a name says which plugin it belongs to
 * and no other plugin can publish under it.
 */
export function isInPluginNamespace(pluginName: string, name: string): boolean {
  return name.startsWith(`${pluginAdminSlug(pluginName)}.`);
}

/**
 * Where one of a plugin's own admin pages is: `/admin/plugins/<slug>/<path>`,
 * for the page's `path` as `contributes.admin.pages` declares it (a leading
 * `/` or none). The admin registers the page at this address, and the
 * prebuilt admin page names the page by it, so the two must be one function.
 */
export function pluginPageAddress(slug: string, path: string): string {
  return `/admin/plugins/${slug}/${path.replace(/^\/+/, "")}`;
}

/**
 * A slug a plugin declares under `contributes.admin.views`, after the
 * plugin's rename map, read from the map's OWN keys: `constructor` is a legal
 * slug, and an inherited lookup answers it with a function the admin would
 * receive as no slug at all. Here, beside the plugin's own slug, so the
 * prebuilt admin page can read it without the boot checks' modules.
 */
export function renamedSlug(
  plugin: PluginDefinition,
  declared: string
): string {
  const renames = plugin.renameMap ?? {};
  return Object.hasOwn(renames, declared) ? renames[declared] : declared;
}

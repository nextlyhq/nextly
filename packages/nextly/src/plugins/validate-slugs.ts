import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";

/**
 * Boot-check that no two plugins address the same admin slug. Throws
 * fail-fast.
 *
 * `pluginAdminSlug` is deliberately lossy — it lowercases and collapses every
 * non-alphanumeric run to one dash — so distinct package names routinely map
 * to one slug: `@acme/plugin-seo`, `@acme/plugin.seo` and `ACME_Plugin_SEO`
 * are all `acme-plugin-seo`. That slug is the plugin's address: the admin
 * builds `/admin/plugins/<slug>` from it, core namespaces the plugin's admin
 * routes with it, and host `pluginOverrides` are looked up by it.
 *
 * So a collision is not a cosmetic clash. Two plugins share one address, and
 * every lookup along it answers with whichever the search reaches first: one
 * plugin's page opens the other's, and one plugin's overrides silently apply
 * to its neighbour.
 *
 * The check belongs HERE rather than at any of those lookups, and that is the
 * whole point. At a lookup there is nothing to observe — `find()` returns a
 * plugin, and a plugin is exactly what a correct lookup returns, so no code
 * downstream can tell "the right one" from "the first of two". Registration is
 * the last moment at which the ambiguity is still visible as ambiguity.
 *
 * @module plugins/validate-slugs
 */
export function validatePluginSlugs(plugins: PluginDefinition[]): void {
  const byslug = new Map<string, string>();

  for (const plugin of plugins) {
    const slug = pluginAdminSlug(plugin.name);
    const owner = byslug.get(slug);

    if (owner !== undefined) {
      // Both names, because neither alone is actionable: the reader has to
      // rename one of them, and the message is the only place the pair is
      // ever stated. The slug is included because it is not obvious from
      // either name which characters collapsed.
      throw resolutionError(
        "duplicate-admin-slug",
        `Plugins "${owner}" and "${plugin.name}" both resolve to the admin ` +
          `slug "${slug}", so they would share one admin address. Rename one ` +
          `of them.`,
        { slug, plugins: [owner, plugin.name] }
      );
    }

    byslug.set(slug, plugin.name);
  }
}

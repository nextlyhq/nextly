/**
 * The slug a plugin's named collection is served under, once the host's
 * rename maps apply: one answer for every contribution that names a
 * collection, the menu's, a filter's and a contribution's alike.
 *
 * @module plugins/served-collection-slug
 */
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";

/**
 * The slug a plugin's collection is served under once the host's rename map
 * applies, or the declared slug where the map does not name it.
 *
 * An OWN property only. `renameMap` is an ordinary object, so a plugin whose
 * collection is legitimately called `constructor` or `toString` would index
 * into `Object.prototype` and resolve its slug to a function — and `??` cannot
 * see that, because an inherited method is neither null nor undefined. The
 * destination would become `/admin/collections/function Object() { [native
 * code] }` and the gate an equally unseeded permission.
 */
export function renamedSlug(
  renameMap: Record<string, string>,
  collection: string
): string {
  const renamed = Object.prototype.hasOwnProperty.call(renameMap, collection)
    ? renameMap[collection]
    : undefined;
  return typeof renamed === "string" ? renamed : collection;
}

/**
 * The plugin that contributes each declared collection slug, the first where
 * two do. Disabled plugins count: their collections are still served.
 */
export function collectionContributors(
  plugins: readonly PluginDefinition[]
): Map<string, PluginDefinition> {
  const contributors = new Map<string, PluginDefinition>();
  for (const plugin of plugins) {
    for (const slug of pluginCollectionSlugs(plugin)) {
      if (!contributors.has(slug)) contributors.set(slug, plugin);
    }
  }
  return contributors;
}

/**
 * The slug a contribution's named collection is served under. A collection is
 * renamed by the host through the plugin that contributes it, so the slug is
 * resolved through that plugin's rename map: the plugin that names it, when
 * it contributes the collection itself, else the plugin that does. A slug no plugin
 * contributes names one of the app's collections, as written.
 */
export function servedCollectionSlug(
  owner: PluginDefinition,
  slug: string,
  contributors: ReadonlyMap<string, PluginDefinition>
): string {
  const contributor = pluginCollectionSlugs(owner).includes(slug)
    ? owner
    : contributors.get(slug);
  return contributor ? renamedSlug(contributor.renameMap ?? {}, slug) : slug;
}

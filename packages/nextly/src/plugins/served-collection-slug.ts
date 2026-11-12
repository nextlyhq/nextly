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

/**
 * The slug a contribution's named Single is served under: a Single the plugin
 * contributes itself through its rename map, as the host registered it; any
 * other names one of the app's Singles, as written.
 */
export function servedSingleSlug(
  owner: PluginDefinition,
  slug: string
): string {
  const own = (owner.contributes?.singles ?? []).some(
    single => single.slug === slug
  );
  return own ? renamedSlug(owner.renameMap ?? {}, slug) : slug;
}

/**
 * A destination naming one of a plugin's collections, pointed at the slug the
 * host registered: a menu item's `to`, and a plugin's `landing`, which is
 * written the way a menu item's `to` is.
 *
 * Returns the declared `to` UNCHANGED when nothing was renamed. Naming a
 * collection is how an item opts into rename-safety and RBAC, not a request to
 * be sent somewhere canonical, so an item whose destination carries list state
 * — `?status=draft`, a hash, a sub-path — keeps it. Overwriting it made adding
 * `collection` to a working link change where that link went.
 *
 * When the slug DID move, only the collection segment is rewritten and
 * whatever followed it is carried across. A destination that does not address
 * the declared collection at all is left alone: the item named a collection so
 * its permission still moves, but a path this function does not recognise is
 * not one it should be inventing a new spelling for.
 */
export function retargetedTo(
  to: string,
  declared: string,
  resolved: string
): string {
  if (declared === resolved) return to;

  const prefix = `/admin/collections/${declared}`;
  const addressesTheList =
    to === prefix ||
    to.startsWith(`${prefix}/`) ||
    to.startsWith(`${prefix}?`) ||
    to.startsWith(`${prefix}#`);
  if (!addressesTheList) return to;

  return `/admin/collections/${resolved}${to.slice(prefix.length)}`;
}

/**
 * The slugs a plugin's entities are registered under.
 *
 * A module of its own, apart from `admin-meta.ts`, because the list
 * dispatchers read it to tell the plugins' entities from the site's, and the
 * admin metadata's builder loads every plugin surface's validation, which a
 * list never needs.
 */

import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { renamedSlug } from "./served-collection-slug";

/** A plugin's collections, Singles and field groups, by registered slug. */
export interface PluginEntitySlugs {
  collections: string[];
  singles: string[];
  fieldGroups: string[];
}

/**
 * The slugs a plugin's entities are registered under: each declared slug
 * through the host's rename, as every list and link in the admin addresses
 * them. A declared slug a host renamed names nothing the admin can find.
 *
 * One answer for the plugin metadata the admin reads and for the lists that
 * separate the plugins' entities from the site's, so an entity a host renamed
 * is the plugin's in both.
 */
export function pluginEntitySlugs(plugin: PluginDefinition): PluginEntitySlugs {
  const renameMap = plugin.renameMap ?? {};
  return {
    collections: pluginCollectionSlugs(plugin).map(declared =>
      renamedSlug(renameMap, declared)
    ),
    singles:
      plugin.contributes?.singles?.map(s => renamedSlug(renameMap, s.slug)) ??
      [],
    fieldGroups:
      plugin.contributes?.fieldGroups?.map(c =>
        renamedSlug(renameMap, c.slug)
      ) ?? [],
  };
}

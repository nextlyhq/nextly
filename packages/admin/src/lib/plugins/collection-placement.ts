import type { PluginMetadata } from "@admin/types/branding";

/**
 * Where a plugin-owned collection belongs in the sidebar.
 *
 * Resolved from the metadata of the plugin that OWNS the collection, found by
 * matching the collection's name against that plugin's declared `collections`.
 *
 * Not from the display group the collection happens to sit under. `admin.group`
 * is an optional heading, so a collection declaring none cannot be found by
 * group at all — and a lookup keyed on it reports "no placement", which reads
 * as "belongs under Plugins". The collection is then listed under Plugins and
 * under wherever its plugin actually placed it.
 *
 * @module lib/plugins/collection-placement
 */
export function resolveCollectionPlacement(
  collectionName: string,
  pluginMetadata: readonly PluginMetadata[] | undefined
): string | undefined {
  if (!pluginMetadata) return undefined;
  const meta = pluginMetadata.find(plugin =>
    (plugin.collections ?? []).includes(collectionName)
  );
  return meta?.placement ?? meta?.group ?? undefined;
}

/**
 * Whether a plugin collection is rendered somewhere other than the Plugins
 * panel, and so must not also be listed inside it.
 *
 * An undeclared placement means Plugins, which is why this is not simply
 * `placement !== "plugins"` applied to an optional value: a collection whose
 * plugin declares nothing belongs here, and treating "unknown" as "elsewhere"
 * would hide it from every section.
 */
export function isCollectionPlacedElsewhere(
  collectionName: string,
  pluginMetadata: readonly PluginMetadata[] | undefined
): boolean {
  const placement = resolveCollectionPlacement(collectionName, pluginMetadata);
  return placement !== undefined && placement !== "plugins";
}

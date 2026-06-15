/**
 * Admin-meta helpers for plugin sidebar rendering.
 *
 * @module plugins/plugin-admin-meta
 */

import type { PluginDefinition } from "./plugin-context";

/**
 * Resolve the collection slugs a plugin owns, for the admin-meta sidebar.
 *
 * Dual-reads the declarative `contributes.collections` (P2) and the deprecated
 * top-level `collections`, deduped by slug, so plugins migrated to
 * `contributes.collections` AND legacy plugins both still render in the admin
 * sidebar. (G3: the longer-term source of truth is merged-schema provenance.)
 */
export function pluginCollectionSlugs(plugin: PluginDefinition): string[] {
  const owned = [
    ...(plugin.contributes?.collections ?? []),
    ...(plugin.collections ?? []),
  ];
  return Array.from(new Set(owned.map(c => c.slug)));
}

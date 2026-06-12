/**
 * Resolved self-identity for a plugin (`ctx.self`, D54).
 *
 * Plugins reference their own entities through `ctx.self.collections[...]`
 * rather than hardcoding slugs, so that the framework-owned remap (D54,
 * shipped in P2) can rename a contributed entity at registration without
 * breaking the plugin's code.
 *
 * In P1 this resolution is **identity** — every declared owned slug maps to
 * itself — because the `.rename()` remap API lands in P2. Introducing the
 * shape now is the forward-compat affordance: third-party plugins that read
 * `ctx.self.*` today keep working unchanged once remap arrives.
 *
 * @module plugins/self
 */

import type { PluginDefinition } from "./plugin-context";

export interface PluginSelf {
  /** The plugin's own name. */
  name: string;
  /** Owned collection slugs → resolved slug (identity in P1). */
  collections: Record<string, string>;
  /** Owned single slugs → resolved slug (identity in P1). */
  singles: Record<string, string>;
}

/**
 * Build a plugin's `ctx.self` from its declared schema. Sources both
 * `contributes.collections`/`contributes.singles` (D12) and the legacy
 * top-level `collections` field still used by first-party plugins.
 */
export function resolvePluginSelf(plugin: PluginDefinition): PluginSelf {
  const collections: Record<string, string> = {};
  for (const c of plugin.contributes?.collections ?? []) {
    collections[c.slug] = c.slug;
  }
  for (const c of plugin.collections ?? []) {
    collections[c.slug] = c.slug;
  }

  const singles: Record<string, string> = {};
  for (const s of plugin.contributes?.singles ?? []) {
    singles[s.slug] = s.slug;
  }

  return { name: plugin.name, collections, singles };
}

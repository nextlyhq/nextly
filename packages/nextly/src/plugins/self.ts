/**
 * Resolved self-identity for a plugin (`ctx.self`, D54).
 *
 * Plugins reference their own entities through `ctx.self.collections[...]`
 * rather than hardcoding slugs, so that the framework-owned remap (D54,
 * shipped) can rename a contributed entity at registration without
 * breaking the plugin's code.
 *
 * In P1 this resolution is **identity** — every declared owned slug maps to
 * itself — because the `.rename()` remap API lands. Introducing the
 * shape now is the forward-compat affordance: third-party plugins that read
 * `ctx.self.*` today keep working unchanged once remap arrives.
 *
 * @module plugins/self
 */

import type { PluginDefinition } from "./plugin-context";

export interface PluginSelf {
  /** The plugin's own name. */
  name: string;
  /** Owned collection slugs → resolved slug (identity). */
  collections: Record<string, string>;
  /** Owned single slugs → resolved slug (identity). */
  singles: Record<string, string>;
}

/**
 * Build a plugin's `ctx.self` from its declared schema. Sources both
 * `contributes.collections`/`contributes.singles` and the legacy
 * top-level `collections` field still used by first-party plugins.
 */
export function resolvePluginSelf(plugin: PluginDefinition): PluginSelf {
  // Key = the plugin's DECLARED slug (what the author writes in code); value =
  // the RESOLVED slug after `.rename()`. Identity when unmapped, so a
  // plugin reading `ctx.self.collections.<declaredSlug>` works whether or not
  // an integrator renamed it.
  const map = plugin.renameMap ?? {};
  // `Object.hasOwn`, not `map[slug] ?? slug`. These maps are keyed by a slug the
  // PLUGIN chose, and a plugin may legitimately own a collection called
  // `constructor` or `toString` — for which a plain lookup returns the
  // inherited function rather than undefined, and the `??` never fires. The
  // resolved "slug" would then be `function Object() { [native code] }`, and
  // every permission and query built from it names a resource that exists
  // nowhere.
  const resolve = (slug: string): string =>
    Object.hasOwn(map, slug) ? map[slug] : slug;

  // Null-prototype, so a CONSUMER reading `self.collections[declared]` cannot
  // inherit one either. Every reader of these maps does exactly that lookup —
  // `library-route.ts` does it to find the patterns collection — and fixing
  // only the writer would leave each of them holding the same hazard.
  const collections: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const c of plugin.contributes?.collections ?? []) {
    collections[c.slug] = resolve(c.slug);
  }
  for (const c of plugin.collections ?? []) {
    collections[c.slug] = resolve(c.slug);
  }

  const singles: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const s of plugin.contributes?.singles ?? []) {
    singles[s.slug] = resolve(s.slug);
  }

  return { name: plugin.name, collections, singles };
}

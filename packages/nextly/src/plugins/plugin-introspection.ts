/**
 * Plugin introspection (D48).
 *
 * A pure, read-only view of what each registered plugin IS and CONTRIBUTES —
 * derived WITHOUT running the plugin (`init` is never called). Reuses the same
 * folds the runtime/CLI boot uses, so introspection matches reality:
 *   - {@link resolvePlugins} for canonical (topo) order + version validation;
 *   - {@link pluginCollectionSlugs} / `contributes.singles|components` for schema;
 *   - {@link collectCustomPermissions} for custom permission slugs (per owner);
 *   - {@link collectPluginRoutes} for route counts (enabled-only, D49);
 *   - {@link buildPluginAdminMeta} for admin menu/page/settings counts.
 *
 * Backs `nextly plugins list` / `nextly plugins info` (D48).
 *
 * @module plugins/plugin-introspection
 */

import type { NextlyServiceConfig } from "../di/register";

import { buildPluginAdminMeta } from "./admin-meta";
import { collectCustomPermissions } from "./permissions/collect-permissions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";
import { collectPluginRoutes } from "./routes/collect-routes";

/** A read-only, introspectable summary of one registered plugin (D48). */
export interface PluginInfo {
  name: string;
  version: string;
  /** Declared core-compatibility range (D6). */
  nextly: string;
  /** `false` when `enabled: false` — schema still applies, behavior is skipped (D49). */
  enabled: boolean;
  dependsOn: string[];
  optionalDependsOn: string[];
  /** Owned collection slugs (resolved, post-rename). */
  collections: string[];
  singles: string[];
  components: string[];
  /** Custom permission slugs declared by this plugin (CRUD is auto-seeded, not listed). */
  permissions: string[];
  /** Custom event names this plugin declares it may emit (D9). */
  events: string[];
  /** Number of HTTP routes contributed (0 when disabled, D49). */
  routeCount: number;
  adminMenuCount: number;
  adminPageCount: number;
  hasSettings: boolean;
  /** Declared-slug → resolved-slug remap applied by the integrator (D54). */
  renamed: Record<string, string>;
}

/**
 * Build the introspection summary for every registered plugin, in resolved
 * (topological) order. Pure. Validates via {@link resolvePlugins} — throws
 * `PLUGIN_RESOLUTION_ERROR` on an invalid/cyclic/incompatible config, the same
 * fail-fast the boot uses (the caller surfaces it).
 */
export function collectPluginInfo(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[],
  opts: { coreVersion: string }
): PluginInfo[] {
  const resolved = resolvePlugins(plugins, { coreVersion: opts.coreVersion });

  // Custom permissions across all plugins, grouped by declaring owner (plugin name).
  const permissionsByOwner = new Map<string, string[]>();
  for (const perm of collectCustomPermissions(config, resolved)) {
    const list = permissionsByOwner.get(perm.owner) ?? [];
    list.push(perm.slug);
    permissionsByOwner.set(perm.owner, list);
  }

  // Route counts per plugin (collectPluginRoutes already skips disabled plugins).
  const routeCountByPlugin = new Map<string, number>();
  for (const route of collectPluginRoutes(resolved)) {
    routeCountByPlugin.set(
      route.pluginName,
      (routeCountByPlugin.get(route.pluginName) ?? 0) + 1
    );
  }

  // Admin menu/page/settings (host overrides only affect placement/appearance,
  // not these counts, so we fold with no overrides).
  const adminMetaByName = new Map(
    buildPluginAdminMeta(resolved, undefined).map(meta => [meta.name, meta])
  );

  return resolved.map(plugin => {
    const contributes = plugin.contributes;
    const meta = adminMetaByName.get(plugin.name);
    return {
      name: plugin.name,
      version: plugin.version,
      nextly: plugin.nextly,
      enabled: plugin.enabled !== false,
      dependsOn: Object.keys(plugin.dependsOn ?? {}),
      optionalDependsOn: Object.keys(plugin.optionalDependsOn ?? {}),
      collections: pluginCollectionSlugs(plugin),
      singles: (contributes?.singles ?? []).map(s => s.slug),
      components: (contributes?.components ?? []).map(c => c.slug),
      permissions: (permissionsByOwner.get(plugin.name) ?? []).sort(),
      events: (contributes?.events ?? []).map(e => e.name),
      routeCount: routeCountByPlugin.get(plugin.name) ?? 0,
      adminMenuCount: meta?.menu?.length ?? 0,
      adminPageCount: meta?.pages?.length ?? 0,
      hasSettings: Boolean(meta?.settings),
      renamed: plugin.renameMap ?? {},
    };
  });
}

/** Find one plugin's info by exact name. Returns `undefined` if not present. */
export function findPluginInfo(
  infos: PluginInfo[],
  name: string
): PluginInfo | undefined {
  return infos.find(i => i.name === name);
}

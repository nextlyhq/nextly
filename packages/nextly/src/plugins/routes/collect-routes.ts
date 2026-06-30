import type { PluginDefinition } from "../plugin-context";

import { routeCollisionError, routeInvalidPathError } from "./route-error";
import type { PluginRoute } from "./route-types";

/** A route collected from a plugin, namespaced and ready to register. */
export interface CollectedRoute {
  pluginName: string;
  method: PluginRoute["method"];
  /** The plugin-declared path (within its namespace). */
  path: string;
  /** Namespaced path: `/plugins/<pluginName><path>`. */
  fullPath: string;
  route: PluginRoute;
}

/**
 * Pure fold of every ENABLED plugin's `contributes.routes` into namespaced,
 * collision-checked routes. Disabled plugins (`enabled: false`) skip
 * behavior — including routes — while their schema is still applied.
 *
 * Throws {@link routeInvalidPathError} for a path without a leading slash and
 * {@link routeCollisionError} when two routes share a `(method, full path)`.
 */
export function collectPluginRoutes(
  plugins: PluginDefinition[]
): CollectedRoute[] {
  const collected: CollectedRoute[] = [];
  // Tracks the first owner of each (method, fullPath) for collision reporting.
  const seen = new Map<string, string>();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const routes = plugin.contributes?.routes;
    if (!routes || routes.length === 0) continue;

    for (const route of routes) {
      if (!route.path.startsWith("/")) {
        throw routeInvalidPathError(plugin.name, route.path);
      }
      const fullPath = `/plugins/${plugin.name}${route.path}`;
      const key = `${route.method} ${fullPath}`;
      const existingOwner = seen.get(key);
      if (existingOwner !== undefined) {
        throw routeCollisionError(route.method, fullPath, [
          existingOwner,
          plugin.name,
        ]);
      }
      seen.set(key, plugin.name);
      collected.push({
        pluginName: plugin.name,
        method: route.method,
        path: route.path,
        fullPath,
        route,
      });
    }
  }

  return collected;
}

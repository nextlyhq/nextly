import type { PluginDefinition } from "../plugin-context";

import { routeCollisionError, routeInvalidPathError } from "./route-error";
import { pluginRouteFullPath } from "./route-path";
import type { PluginRoute } from "./route-types";

/** A route collected from a plugin, namespaced and ready to register. */
export interface CollectedRoute {
  pluginName: string;
  method: PluginRoute["method"];
  /** The plugin-declared path (within its namespace). */
  path: string;
  /** Where it answers: `/plugins/<pluginName><path>`, or `<path>` when rooted. */
  fullPath: string;
  route: PluginRoute;
}

/**
 * A path reduced to what decides whether two patterns answer the same URL.
 *
 * Every capture becomes one placeholder, so the NAME of a parameter stops
 * mattering: two routes that differ only there are indistinguishable at
 * request time and one of them would never be reached.
 */
function collisionShape(fullPath: string): string {
  return fullPath
    .split("/")
    .map(segment => (segment.startsWith(":") ? ":" : segment))
    .join("/");
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
      const fullPath = pluginRouteFullPath(
        plugin.name,
        route.path,
        route.mount
      );
      // Keyed on the SHAPE, not the text. `/hooks/:id` and `/hooks/:slug` are
      // different strings and the same URL, so an exact-string key let two
      // plugins claim one address and left the winner to registration order.
      // A literal still differs from a capture: `/items/count` beside
      // `/items/:id` is an ordinary pair, and the matcher prefers the literal.
      const key = `${route.method} ${collisionShape(fullPath)}`;
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

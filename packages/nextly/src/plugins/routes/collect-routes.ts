import type { PluginDefinition } from "../plugin-context";

import { routeCollisionError, routeInvalidPathError } from "./route-error";
import { pluginRouteFullPath } from "./route-path";
import { literalCount, patternsOverlap, splitPath } from "./route-pattern";
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
  // Every pattern collected so far, kept whole rather than hashed, because
  // overlap is a comparison between two patterns and not a property of one.
  const seen: Array<{
    method: PluginRoute["method"];
    segments: string[];
    literals: number;
    owner: string;
  }> = [];

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
      // Compared against every route already collected, using the matcher's own
      // overlap rule. A hash of the path cannot express this: `/x/:id/end` and
      // `/x/fixed/:tail` share neither text nor shape and both answer
      // `/x/fixed/end`.
      //
      // Overlapping alone is not a collision. `/items/count` beside
      // `/items/:id` overlaps and is an ordinary pair, because the matcher
      // prefers the pattern with more literals. It is a collision when they
      // overlap AND carry the same number of literals, which is exactly when
      // the tie-break has nothing to choose on and registration order decides.
      const segments = splitPath(fullPath);
      const literals = literalCount(segments);
      const clash = seen.find(
        other =>
          other.method === route.method &&
          other.literals === literals &&
          patternsOverlap(other.segments, segments)
      );
      if (clash !== undefined) {
        throw routeCollisionError(route.method, fullPath, [
          clash.owner,
          plugin.name,
        ]);
      }
      seen.push({
        method: route.method,
        segments,
        literals,
        owner: plugin.name,
      });
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

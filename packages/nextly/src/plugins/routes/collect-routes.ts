import { listAdminRestOperations } from "../../route-handler/admin-rest-descriptors";
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
  /** Match path under the admin API root (namespaced, or the path for admin-api mounts). */
  fullPath: string;
  route: PluginRoute;
}

/**
 * First path segments an `admin-api` mounted route may not use: every system
 * REST resource (derived live from the admin REST seam, so it stays current as
 * the surface grows) plus the plugin namespace itself, the media sub-mount, and
 * the dev-only branches. A plugin route matching BEFORE the REST router would
 * shadow the built-in handler, so this is refused at boot.
 */
function reservedAdminApiSegments(): Set<string> {
  const segments = new Set<string>(["plugins", "media", "_dev", "dev-reload"]);
  for (const op of listAdminRestOperations()) {
    const first = op.path.split("/").filter(Boolean)[0];
    if (first) segments.add(first);
  }
  return segments;
}

/**
 * Pure fold of every ENABLED plugin's `contributes.routes` into namespaced,
 * collision-checked routes. Disabled plugins (`enabled: false`) skip
 * behavior — including routes — while their schema is still applied.
 *
 * Throws {@link routeInvalidPathError} for a path without a leading slash,
 * {@link routeCollisionError} when two routes share a `(method, full path)`, and
 * a collision error when an `admin-api` mounted route's first segment names a
 * system REST resource.
 */
export function collectPluginRoutes(
  plugins: PluginDefinition[]
): CollectedRoute[] {
  const collected: CollectedRoute[] = [];
  // Tracks the first owner of each (method, fullPath) for collision reporting.
  const seen = new Map<string, string>();
  const reserved = reservedAdminApiSegments();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const routes = plugin.contributes?.routes;
    if (!routes || routes.length === 0) continue;

    for (const route of routes) {
      if (!route.path.startsWith("/")) {
        throw routeInvalidPathError(plugin.name, route.path);
      }
      const fullPath = pluginRouteFullPath(plugin.name, route);
      // An admin-api route sits ahead of the REST router in dispatch order; one
      // whose first segment names a system resource would shadow it.
      if (
        route.mount === "admin-api" &&
        reserved.has(route.path.split("/").filter(Boolean)[0] ?? "")
      ) {
        throw routeCollisionError(route.method, fullPath, [
          plugin.name,
          "admin REST surface",
        ]);
      }
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

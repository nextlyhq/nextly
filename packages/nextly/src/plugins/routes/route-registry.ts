import type { PluginContext } from "../plugin-context";

import { pluginRouteFullPath } from "./route-path";
import { literalCount, matchPattern, splitPath } from "./route-pattern";
import type { PluginRoute, RouteMethod } from "./route-types";

/**
 * A route registered at boot: the plugin's declared {@link PluginRoute}, its
 * namespaced full path, and the plugin's boot-built base {@link PluginContext}
 * (the dispatcher clones it per request, adding `user`/`params`).
 */
export interface RegisteredRoute {
  pluginName: string;
  method: RouteMethod;
  /** Where it answers: `/plugins/<pluginName><route.path>`, or `<route.path>`. */
  fullPath: string;
  /** Which pass matches it. See {@link PluginRoute.mount}. */
  mount: "plugin" | "root";
  route: PluginRoute;
  baseCtx: PluginContext;
  /** Pre-split path segments (literal, or `:name` capture) for matching. */
  segments: string[];
}

/** A successful match: the route plus the captured path params. */
export interface RouteMatch {
  pluginName: string;
  route: PluginRoute;
  baseCtx: PluginContext;
  params: Record<string, string>;
}

/**
 * Registry of plugin-contributed HTTP routes. globalThis-backed singleton
 * mirroring the hook/event/filter registries so registration survives Next.js/
 * Turbopack ESM re-evaluation.
 */
export class PluginRouteRegistry {
  private routes: RegisteredRoute[] = [];

  register(
    pluginName: string,
    route: PluginRoute,
    baseCtx: PluginContext
  ): void {
    const mount = route.mount ?? "plugin";
    const fullPath = pluginRouteFullPath(pluginName, route.path, mount);
    this.routes.push({
      pluginName,
      method: route.method,
      fullPath,
      mount,
      route,
      baseCtx,
      segments: splitPath(fullPath),
    });
  }

  /**
   * Match an incoming (method, path) against registered routes of one mount.
   *
   * The mount is a REQUIRED argument rather than a search across both, because
   * the two are consulted at different points in the request: namespaced routes
   * before the built-in router, root routes only after it has declined. Matching
   * both at once would put a plugin's root route ahead of the core route it
   * shares a path with, which is the one thing this must not allow.
   */
  match(
    method: string,
    path: string,
    mount: "plugin" | "root"
  ): RouteMatch | null {
    const pathSegments = splitPath(path);
    let best: { match: RouteMatch; literals: number } | null = null;
    for (const entry of this.routes) {
      if (entry.mount !== mount) continue;
      if (entry.method !== method) continue;
      const params = matchPattern(entry.segments, pathSegments);
      if (params === null) continue;
      // The tie-break when more than one pattern matches: the most literal
      // wins. `/items/count` and `/items/:id` both answer `/items/count`, and
      // without a rule the winner is whichever plugin registered first, which
      // is registration order dressed up as routing.
      const literals = literalCount(entry.segments);
      // Kept rather than returned: a later pattern may be more specific, and
      // returning the first match is what made registration order the rule.
      if (best === null || literals > best.literals) {
        best = {
          literals,
          match: {
            pluginName: entry.pluginName,
            route: entry.route,
            baseCtx: entry.baseCtx,
            params,
          },
        };
      }
    }
    return best?.match ?? null;
  }

  list(): RegisteredRoute[] {
    return [...this.routes];
  }

  clear(): void {
    this.routes = [];
  }
}

// Use globalThis to survive ESM module duplication in Next.js/Turbopack — the
// same guard the hook/event/filter registries use.
const globalForRoutes = globalThis as unknown as {
  __nextly_pluginRouteRegistry?: PluginRouteRegistry;
};

if (!globalForRoutes.__nextly_pluginRouteRegistry) {
  globalForRoutes.__nextly_pluginRouteRegistry = new PluginRouteRegistry();
}

const globalRegistry: PluginRouteRegistry =
  globalForRoutes.__nextly_pluginRouteRegistry;

/** Get the global plugin route registry singleton. */
export function getPluginRouteRegistry(): PluginRouteRegistry {
  return globalRegistry;
}

/** Reset the global plugin route registry (testing + per-boot). */
export function resetPluginRouteRegistry(): void {
  globalRegistry.clear();
}

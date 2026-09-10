import type { PluginContext } from "../plugin-context";

import { pluginRouteFullPath } from "./route-path";
import { selectMostSpecific, splitPath } from "./route-pattern";
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
   *
   * Which of several matches wins is {@link selectMostSpecific}'s to say, not
   * this method's: the boot predicate has to reach the same route from the
   * declarations alone, and it can only do that if the rule is somewhere both
   * can read.
   */
  match(
    method: string,
    path: string,
    mount: "plugin" | "root"
  ): RouteMatch | null {
    const selected = selectMostSpecific(
      this.routes.filter(
        entry => entry.mount === mount && entry.method === method
      ),
      entry => entry.segments,
      splitPath(path)
    );
    if (selected === null) return null;
    const { candidate, params } = selected;
    return {
      pluginName: candidate.pluginName,
      route: candidate.route,
      baseCtx: candidate.baseCtx,
      params,
    };
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

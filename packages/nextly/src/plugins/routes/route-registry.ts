import type { PluginContext } from "../plugin-context";

import type { PluginRoute, RouteMethod } from "./route-types";

/**
 * A route registered at boot: the plugin's declared {@link PluginRoute}, its
 * namespaced full path, and the plugin's boot-built base {@link PluginContext}
 * (the dispatcher clones it per request, adding `user`/`params`).
 */
export interface RegisteredRoute {
  pluginName: string;
  method: RouteMethod;
  /** Namespaced path: `/plugins/<pluginName><route.path>`. */
  fullPath: string;
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

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
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
    const fullPath = `/plugins/${pluginName}${route.path}`;
    this.routes.push({
      pluginName,
      method: route.method,
      fullPath,
      route,
      baseCtx,
      segments: splitPath(fullPath),
    });
  }

  /** Match an incoming (method, path) against registered routes. */
  match(method: string, path: string): RouteMatch | null {
    const pathSegments = splitPath(path);
    for (const entry of this.routes) {
      if (entry.method !== method) continue;
      if (entry.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < entry.segments.length; i++) {
        const seg = entry.segments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = pathSegments[i];
        } else if (seg !== pathSegments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return {
          pluginName: entry.pluginName,
          route: entry.route,
          baseCtx: entry.baseCtx,
          params,
        };
      }
    }
    return null;
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

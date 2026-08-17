import type { PermissionSlug } from "../contributions";
import type { PluginContext } from "../plugin-context";

import { pluginRouteFullPath } from "./route-path";
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
    // Same helper collection uses, so the match path can never disagree with
    // the collision-checked path.
    const fullPath = pluginRouteFullPath(pluginName, route);
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

/**
 * A read-only, safe view of one registered plugin route for introspection
 * consumers (the api-docs plugin, tooling). Deliberately excludes the boot-built
 * `baseCtx` — that carries services and db handles no introspection reader
 * should be handed.
 */
export interface PluginRouteInfo {
  pluginName: string;
  method: RouteMethod;
  /** Path within the plugin namespace (leading "/", `:param` segments). */
  path: string;
  /**
   * Match path under the admin API root: `/plugins/<pluginName><path>` for the
   * default `plugins` mount, or `path` itself for an `admin-api` mount.
   */
  fullPath: string;
  /** Whether the route is publicly callable (secure by default otherwise). */
  public: boolean;
  /** The permission slug required to call the route, when gated. */
  requiredPermission?: PermissionSlug;
  /** The route's optional OpenAPI annotation, verbatim. */
  openapi?: PluginRoute["openapi"];
}

/**
 * List every registered plugin route as a safe, read-only view. General
 * introspection (the mirror of `listAdminRestOperations` for plugin-contributed
 * routes) — the docs plugin consumes it, and nothing here exposes handler
 * functions or contexts.
 */
export function listPluginRoutes(): PluginRouteInfo[] {
  return globalRegistry.list().map(entry => ({
    pluginName: entry.pluginName,
    method: entry.method,
    path: entry.route.path,
    fullPath: entry.fullPath,
    public: entry.route.public === true,
    requiredPermission: entry.route.requiredPermission,
    openapi: entry.route.openapi,
  }));
}

/**
 * Plugin-route derivation for the docs spec.
 *
 * Plugin HTTP routes are declarative by construction — `{ method, path,
 * requiredPermission?, public? }` registered at boot — so this is a pure
 * DERIVATION from the sdk's read-only `listPluginRoutes()` view: zero plugin
 * action required to appear in the spec, and an optional `openapi?` annotation
 * enriches the operation when present.
 *
 * @module plugin-routes
 * @since alpha
 */
import type { PluginRouteInfo } from "@nextlyhq/plugin-sdk";

import type { DocsOperation } from "./descriptors";

/**
 * Convert a plugin path using `:param` segments into an OpenAPI `{param}` path
 * template. Only segment-leading colons are converted.
 */
function toOpenApiPath(path: string): string {
  return path.replace(/\/:[A-Za-z_][\w]*/g, seg => `/{${seg.slice(2)}}`);
}

/**
 * Derive an auth mode from a route's secure-by-default flags: `public` wins;
 * otherwise a `requiredPermission` makes it permission-gated; otherwise it is
 * authenticated (secure by default still requires a session, just no slug).
 */
function deriveAuth(route: PluginRouteInfo): DocsOperation["auth"] {
  if (route.public) return "public";
  if (route.requiredPermission) return "permission";
  return "authenticated";
}

/**
 * Build a stable, unique operation id for a plugin route: plugin, verb, and a
 * flattened form of the plugin-RELATIVE path (not the full path, which would
 * repeat the plugin name).
 */
function pluginOperationId(route: PluginRouteInfo): string {
  const tail = route.path
    .replace(/[:{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${route.pluginName}.${route.method.toLowerCase()}.${tail || "root"}`;
}

/**
 * Map the sdk's plugin-route view to documented operations. Pure: takes the
 * routes as input so it is testable without the global registry.
 */
export function pluginRoutesToDocs(
  routes: readonly PluginRouteInfo[]
): DocsOperation[] {
  return routes.map(route => ({
    service: "plugins",
    operation: pluginOperationId(route),
    method: route.method,
    path: toOpenApiPath(route.fullPath),
    auth: deriveAuth(route),
    permissionSlug: route.requiredPermission,
    tag: `Plugin: ${route.pluginName}`,
    // Fold the optional annotation through; absent fields stay undefined.
    summary: route.openapi?.summary,
    description: route.openapi?.description,
    tags: route.openapi?.tags,
  }));
}

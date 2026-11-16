/**
 * The routes of a plugin that say nothing about what reaching them takes.
 *
 * Every route a staff session or an API key can reach declares a permission,
 * `public`, a plugin's kind of `principal`, or `siteWide: false`; one that
 * declares none is refused for every caller. A plugin's own test asserts this
 * list is empty, so an undeclared route fails the plugin's suite rather than
 * every request that reaches it. It reads the routes the plugin's definition
 * actually contributes, so it cannot miss one the way a scan of source could.
 *
 * @module plugins/routes/undeclared-routes
 */
import type { PluginDefinition } from "../plugin-context";

import { routeDeclaresAccess } from "./route-options";

/**
 * Each undeclared route of `plugin`, as `METHOD /path`, in declaration order;
 * empty when every route declares what it takes.
 *
 * @example
 * ```ts
 * expect(undeclaredPluginRoutes(myPlugin())).toEqual([]);
 * ```
 */
export function undeclaredPluginRoutes(plugin: PluginDefinition): string[] {
  return (plugin.contributes?.routes ?? [])
    .filter(route => !routeDeclaresAccess(route))
    .map(route => `${route.method} ${route.path}`);
}

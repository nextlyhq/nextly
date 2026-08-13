/**
 * The HTTP path a plugin route is served at.
 *
 * The RAW package name, not the admin slug. `PluginRouteRegistry.register`
 * builds `/plugins/${plugin.name}${route.path}`, so a scoped package is served
 * at `/api/plugins/@acme/p/export` while its admin address is
 * `/admin/plugins/acme-p` — the slug is how the ADMIN addresses a plugin and
 * has never been how the dispatcher does.
 *
 * One implementation because two surfaces name these paths: what a plugin
 * serves now, and what enabling a disabled one would serve. A reader comparing
 * the two must not be shown a path that differs for any reason but the
 * question being asked.
 *
 * @module lib/plugins/plugin-route-path
 */
export function pluginRoutePath(pluginName: string, routePath: string): string {
  return `/api/plugins/${pluginName}${routePath}`;
}

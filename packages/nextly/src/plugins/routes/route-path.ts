/**
 * The namespace a plugin's route is served under.
 *
 * One implementation because three places name it: the registry that mounts
 * the route, the fold that collision-checks it before mounting, and the admin
 * metadata that tells a reader where it will answer. Those agreed by having
 * the same expression typed out three times, which is agreement that lasts
 * exactly until someone changes the namespace in two of them.
 *
 * The RAW package name, not the admin slug. `@acme/p` is served at
 * `/plugins/@acme/p/export` while the admin addresses it as
 * `/admin/plugins/acme-p`; the slug is how the ADMIN names a plugin and has
 * never been how the dispatcher does.
 *
 * No mount prefix: the host app decides where the Nextly handler is mounted, so
 * that half is the caller's to add. The scaffold mounts it at
 * `src/app/admin/api/[[...params]]/route.ts`, which makes the full address
 * `/admin/api/plugins/<name><path>` in a generated project. This comment said
 * `/api/...` "by convention" and four documentation pages were written from it,
 * every one of them naming a URL that 404s in a scaffolded app.
 *
 * @module plugins/routes/route-path
 */

import type { PluginRouteMount } from "./route-types";

/**
 * The first segment every namespaced route sits under.
 *
 * Read by the reachability check that refuses a root route here, and by the
 * boot predicate that uses it to rule the namespaced pass out for a path that
 * cannot be under it. Both were spelling the literal themselves, which is the
 * same agreement-by-retyping the path builder below exists to end.
 */
export const PLUGIN_NAMESPACE_SEGMENT = "plugins";

export function pluginRouteFullPath(
  pluginName: string,
  routePath: string,
  mount: PluginRouteMount = "plugin"
): string {
  // A root route answers at the address it declares. It is still collected and
  // collision-checked like any other, and the dispatcher consults it only after
  // the built-in router declines, so the namespace it gives up buys no reach
  // into anything core serves.
  return mount === "root"
    ? routePath
    : `/${PLUGIN_NAMESPACE_SEGMENT}/${pluginName}${routePath}`;
}

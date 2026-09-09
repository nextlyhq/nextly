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
 * No mount prefix: the host app decides where the Nextly handler is mounted
 * (`/api/...` by convention), so that half is the caller's to add.
 *
 * @module plugins/routes/route-path
 */

import type { PluginRouteMount } from "./route-types";

export function pluginRouteFullPath(
  pluginName: string,
  routePath: string,
  mount: PluginRouteMount = "plugin"
): string {
  // A root route answers at the address it declares. It is still collected and
  // collision-checked like any other, and the dispatcher consults it only after
  // the built-in router declines, so the namespace it gives up buys no reach
  // into anything core serves.
  return mount === "root" ? routePath : `/plugins/${pluginName}${routePath}`;
}

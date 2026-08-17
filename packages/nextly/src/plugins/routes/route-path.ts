import type { PluginRoute } from "./route-types";

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
 * No mount prefix beyond the above: the host app decides where the Nextly
 * handler is mounted (`/api/...` by convention), so that half is the caller's
 * to add.
 *
 * Two mount modes: the default `plugins` mount is namespaced under
 * `/plugins/<pluginName>`; the opt-in `admin-api` mount returns the path
 * as-is, serving the route at the admin API root for surfaces that read as
 * first-party (the docs plugin's `/docs`). What that mode may not shadow is
 * decided in `collect-routes.ts`, which refuses first segments that name or
 * wildcard system resources.
 *
 * @module plugins/routes/route-path
 */
export function pluginRouteFullPath(
  pluginName: string,
  route: Pick<PluginRoute, "mount" | "path">
): string {
  return route.mount === "admin-api"
    ? route.path
    : `/plugins/${pluginName}${route.path}`;
}

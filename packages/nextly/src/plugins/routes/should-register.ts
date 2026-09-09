/**
 * Whether THIS request could reach a plugin route that is not registered yet.
 *
 * Plugin routes are registered during service initialisation, and that is lazy.
 * An app wired through `createDynamicHandlers({ config })` has an empty registry
 * on its first request, so a public plugin route answers 400 until something
 * else happens to boot the app, and a serverless worker repeats that on every
 * cold start.
 *
 * Booting because the app HAS routes is the wrong test. A cold request to
 * `/api/garbage` would then run database and plugin startup before answering
 * 400, so anonymous scanning could force that work on demand. The question has
 * to be about this request: does some declared, enabled route match the method
 * and path in front of us?
 *
 * Answered from the config alone, using the matcher's own grammar, so no boot
 * is needed to decide whether to boot.
 *
 * @module plugins/routes/should-register
 */

import { pluginRouteFullPath } from "./route-path";
import { matchPattern, splitPath } from "./route-pattern";
import type { PluginRoute } from "./route-types";

/** The part of a plugin definition this reads. */
interface RouteContributor {
  name: string;
  enabled?: boolean;
  contributes?: { routes?: PluginRoute[] };
}

export function shouldRegisterPluginRoutes(
  registeredCount: number,
  plugins: readonly RouteContributor[] | undefined,
  method: string,
  path: string
): boolean {
  // Already filled: every request after the first, which is nearly all of them.
  if (registeredCount > 0) return false;

  const pathSegments = splitPath(path);
  return (plugins ?? []).some(plugin => {
    // A disabled plugin contributes no behaviour, routes included, so booting
    // for one of its paths would boot for a route that will never answer.
    if (plugin.enabled === false) return false;
    return (plugin.contributes?.routes ?? []).some(route => {
      if (route.method !== method) return false;
      const full = pluginRouteFullPath(plugin.name, route.path, route.mount);
      return matchPattern(splitPath(full), pathSegments) !== null;
    });
  });
}

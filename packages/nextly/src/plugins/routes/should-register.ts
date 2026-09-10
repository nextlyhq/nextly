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
  setup?: unknown;
  contributes?: { routes?: PluginRoute[] };
}

/** What the caller knows about the request, beyond where it is going. */
export interface BootDecisionRequest {
  method: string;
  path: string;
  /**
   * Whether the request carries a credential at all, read without touching the
   * container: a cookie parse and a header read.
   */
  hasCredential: boolean;
}

/**
 * The declared route this request would reach, or `null`.
 *
 * Reads what plugins DECLARE, which is all that is knowable before the boot
 * this helps decide. Disabled plugins contribute no behaviour, routes included.
 */
function declaredCandidate(
  plugins: readonly RouteContributor[],
  method: string,
  path: string
): PluginRoute | null {
  const pathSegments = splitPath(path);
  for (const plugin of plugins) {
    for (const route of plugin.contributes?.routes ?? []) {
      if (route.method !== method) continue;
      const full = pluginRouteFullPath(plugin.name, route.path, route.mount);
      if (matchPattern(splitPath(full), pathSegments) !== null) return route;
    }
  }
  return null;
}

export function shouldRegisterPluginRoutes(
  registeredCount: number,
  plugins: readonly RouteContributor[] | undefined,
  request: BootDecisionRequest
): boolean {
  // Already filled: every request after the first, which is nearly all of them.
  if (registeredCount > 0) return false;

  const enabled = (plugins ?? []).filter(plugin => plugin.enabled !== false);

  // A `setup` transformer runs during initialisation and may add, replace or
  // alter routes, so what a plugin declares is not the whole set. Only running
  // it can say, which is the thing being decided, so an app that has one boots
  // and this stops claiming to know. No in-tree plugin does, so the precise
  // path below is the one almost every app takes.
  if (enabled.some(plugin => typeof plugin.setup === "function")) return true;

  const candidate = declaredCandidate(enabled, request.method, request.path);
  if (candidate === null) return false;

  // A secure route answers 401 to a caller carrying nothing, and that answer
  // needs no database. Booting for it would hand an anonymous caller a cold
  // start on every protected endpoint it can name.
  return candidate.public === true || request.hasCredential;
}

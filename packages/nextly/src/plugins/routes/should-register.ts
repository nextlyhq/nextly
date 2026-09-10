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
 * Answered from the config alone, using the matcher's own grammar and its own
 * tie-break, so no boot is needed to decide whether to boot -- and so the route
 * this reaches is the route the warm registry would reach. Asked PER MOUNT,
 * because the two are consulted at different points in the request and a
 * decision that pooled them would boot for a path the built-in router serves.
 *
 * @module plugins/routes/should-register
 */

import { PLUGIN_NAMESPACE_SEGMENT, pluginRouteFullPath } from "./route-path";
import { selectMostSpecific, splitPath } from "./route-pattern";
import type { PluginRoute, PluginRouteMount } from "./route-types";

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
 * What the caller should do before matching this mount's pass.
 *
 * `authRequired` carries the declared route rather than a finished response,
 * for the reason `resolvePluginRouteAuth` returns a failure rather than one:
 * a plugin route's error body is built at a single boundary, and a second
 * builder is how a refusal came back in a shape the route's own errors do not
 * use.
 */
export type PluginRouteBootDecision =
  | { kind: "skip" }
  | { kind: "boot" }
  | { kind: "authRequired"; route: PluginRoute };

const SKIP: PluginRouteBootDecision = { kind: "skip" };
const BOOT: PluginRouteBootDecision = { kind: "boot" };

/** Every enabled plugin's declared routes for one mount, paired with its owner. */
function declaredFor(
  plugins: readonly RouteContributor[],
  method: string,
  mount: PluginRouteMount
): { plugin: RouteContributor; route: PluginRoute; segments: string[] }[] {
  const declared = [];
  for (const plugin of plugins) {
    for (const route of plugin.contributes?.routes ?? []) {
      if (route.method !== method) continue;
      if ((route.mount ?? "plugin") !== mount) continue;
      declared.push({
        plugin,
        route,
        segments: splitPath(
          pluginRouteFullPath(plugin.name, route.path, mount)
        ),
      });
    }
  }
  return declared;
}

/**
 * Whether a route of this mount could match this path at all, cheaply.
 *
 * Only the namespaced mount has an answer: every route it files sits under
 * `/plugins/<name>`, a literal first segment no other path reaches. It is what
 * lets an app with a `setup` transformer -- whose route set cannot be known
 * before boot -- still refuse to boot for the paths that transformer could
 * never claim. A root route may be declared anywhere, so this says nothing
 * about it; the root pass is instead consulted only after the built-in router
 * has declined, which excludes core's traffic by ordering rather than by test.
 */
function mountCouldReach(mount: PluginRouteMount, path: string): boolean {
  if (mount !== "plugin") return true;
  return splitPath(path)[0] === PLUGIN_NAMESPACE_SEGMENT;
}

export function pluginRouteBootDecision(
  registeredCount: number,
  plugins: readonly RouteContributor[] | undefined,
  request: BootDecisionRequest,
  mount: PluginRouteMount
): PluginRouteBootDecision {
  // Already filled: every request after the first, which is nearly all of them.
  // The registry answers from here on, including the 401 a secure route owes an
  // anonymous caller, so there is nothing for this to decide.
  if (registeredCount > 0) return SKIP;

  if (!mountCouldReach(mount, request.path)) return SKIP;

  const enabled = (plugins ?? []).filter(plugin => plugin.enabled !== false);

  // A `setup` transformer runs during initialisation and may add, replace or
  // alter routes, so what a plugin declares is not the whole set. Only running
  // it can say, which is the thing being decided, so an app that has one boots
  // and this stops claiming to know. No in-tree plugin does, so the precise
  // path below is the one almost every app takes.
  if (enabled.some(plugin => typeof plugin.setup === "function")) return BOOT;

  const selected = selectMostSpecific(
    declaredFor(enabled, request.method, mount),
    declared => declared.segments,
    splitPath(request.path)
  );
  if (selected === null) return SKIP;

  // A secure route answers 401 to a caller carrying nothing, and that answer
  // needs no database. Booting for it would hand an anonymous caller a cold
  // start on every protected endpoint it can name -- but simply not booting
  // leaves the request to the invalid-route 400, so the same call is refused
  // two different ways depending on whether a worker happened to be warm.
  if (selected.candidate.route.public === true || request.hasCredential) {
    return BOOT;
  }
  return { kind: "authRequired", route: selected.candidate.route };
}

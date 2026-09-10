import type { PluginDefinition } from "../plugin-context";

import { rootMountUnreachableReason } from "./root-mount-reach";
import {
  routeCollisionError,
  routeInvalidMountError,
  routeInvalidPathError,
  routeUnreachableRootError,
} from "./route-error";
import { pluginRouteFullPath } from "./route-path";
import { literalCount, patternsOverlap, splitPath } from "./route-pattern";
import type { PluginRoute, PluginRouteMount } from "./route-types";

/** A route collected from a plugin, namespaced and ready to register. */
export interface CollectedRoute {
  pluginName: string;
  method: PluginRoute["method"];
  /** The plugin-declared path (within its namespace). */
  path: string;
  /** Where it answers: `/plugins/<pluginName><path>`, or `<path>` when rooted. */
  fullPath: string;
  route: PluginRoute;
}

/**
 * Every mount a route may declare.
 *
 * Spelled once here and compared against, rather than asked as
 * `mount === "plugin" || mount === "root"`, so adding a third mount to the
 * union makes this fail to compile instead of silently rejecting it.
 */
const MOUNTS = [
  "plugin",
  "root",
] as const satisfies readonly PluginRouteMount[];

/** A pattern already claimed, kept whole so overlap can be asked of the pair. */
interface ClaimedPattern {
  method: PluginRoute["method"];
  /** Which pass would match it. Two mounts are never matched together. */
  mount: PluginRouteMount;
  segments: string[];
  literals: number;
  owner: string;
}

/**
 * Refuse a path this route could not answer on, before it is registered.
 *
 * A leading slash is the shape every path needs, and the mount has to be one
 * the matcher will ask for. A ROOT path additionally has to sit somewhere the
 * root pass is consulted, which `root-mount-reach` decides.
 */
function assertPathUsable(pluginName: string, route: PluginRoute): void {
  if (!route.path.startsWith("/")) {
    throw routeInvalidPathError(pluginName, route.path);
  }
  // Checked rather than trusted to the type, because a plugin authored in
  // JavaScript reaches here unchecked. Everything downstream then disagrees
  // about the value: the path builder reads anything but "root" as namespaced,
  // the registry keeps the typo, and the matcher asks for neither.
  if (route.mount !== undefined && !MOUNTS.includes(route.mount)) {
    throw routeInvalidMountError(pluginName, route.path, route.mount);
  }
  if (route.mount !== "root") return;
  const unreachable = rootMountUnreachableReason(route.path);
  if (unreachable !== null) {
    throw routeUnreachableRootError(pluginName, route.path, unreachable);
  }
}

/**
 * Refuse a pattern another plugin's already answers for.
 *
 * Compared with the matcher's own overlap rule rather than a hash of the path,
 * which cannot express a relationship between two patterns: `/x/:id/end` and
 * `/x/fixed/:tail` share neither text nor shape and both answer `/x/fixed/end`.
 *
 * Overlapping alone is not a collision. `/items/count` beside `/items/:id`
 * overlaps and is an ordinary pair, because the matcher prefers the pattern
 * with more literals. It is a collision when they overlap AND carry the same
 * number of literals, which is exactly when that tie-break has nothing to
 * choose on and registration order decides.
 *
 * Asked WITHIN one mount, because that is the only place the ambiguity can
 * arise: the registry matches each pass separately, so two patterns under
 * different mounts never compete for one request even when they overlap.
 * `/plugins/foo/bar/:id` and a root `/:scope/foo/bar/baz` do overlap, and
 * refusing that pair at boot would reject a root route that answers
 * `/custom/foo/bar/baz` perfectly well and never contests the namespaced pass.
 */
function assertUnclaimed(
  seen: readonly ClaimedPattern[],
  claim: ClaimedPattern,
  fullPath: string
): void {
  const clash = seen.find(
    other =>
      other.method === claim.method &&
      other.mount === claim.mount &&
      other.literals === claim.literals &&
      patternsOverlap(other.segments, claim.segments)
  );
  if (clash !== undefined) {
    throw routeCollisionError(claim.method, fullPath, [
      clash.owner,
      claim.owner,
    ]);
  }
}

/**
 * Pure fold of every ENABLED plugin's `contributes.routes` into namespaced,
 * collision-checked routes. Disabled plugins (`enabled: false`) skip
 * behavior, routes included, while their schema is still applied.
 *
 * Every refusal it raises is built in `route-error.ts` and listed there, so a
 * caller deciding what a throw means reads that list rather than one repeated
 * here, which is how the reachability refusal came to be unhandled.
 */
export function collectPluginRoutes(
  plugins: PluginDefinition[]
): CollectedRoute[] {
  const collected: CollectedRoute[] = [];
  const seen: ClaimedPattern[] = [];

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const route of plugin.contributes?.routes ?? []) {
      assertPathUsable(plugin.name, route);
      // Resolved once, so the claim is checked against the same mount the
      // registry will file it under.
      const mount = route.mount ?? "plugin";
      const fullPath = pluginRouteFullPath(plugin.name, route.path, mount);
      const segments = splitPath(fullPath);
      const claim: ClaimedPattern = {
        method: route.method,
        mount,
        segments,
        literals: literalCount(segments),
        owner: plugin.name,
      };
      assertUnclaimed(seen, claim, fullPath);
      seen.push(claim);
      collected.push({
        pluginName: plugin.name,
        method: route.method,
        path: route.path,
        fullPath,
        route,
      });
    }
  }

  return collected;
}

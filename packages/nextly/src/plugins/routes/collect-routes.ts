import type { PluginDefinition } from "../plugin-context";

import { rootMountUnreachableReason } from "./root-mount-reach";
import {
  routeCollisionError,
  routeInvalidPathError,
  routeUnreachableRootError,
} from "./route-error";
import { pluginRouteFullPath } from "./route-path";
import { literalCount, patternsOverlap, splitPath } from "./route-pattern";
import type { PluginRoute } from "./route-types";

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
 * Pure fold of every ENABLED plugin's `contributes.routes` into namespaced,
 * collision-checked routes. Disabled plugins (`enabled: false`) skip
 * behavior — including routes — while their schema is still applied.
 *
 * Throws {@link routeInvalidPathError} for a path without a leading slash and
 * {@link routeCollisionError} when two routes share a `(method, full path)`.
 */
/** A pattern already claimed, kept whole so overlap can be asked of the pair. */
interface ClaimedPattern {
  method: PluginRoute["method"];
  segments: string[];
  literals: number;
  owner: string;
}

/**
 * Refuse a path this route could not answer on, before it is registered.
 *
 * A leading slash is the shape every path needs. A ROOT path additionally has
 * to sit somewhere the root pass is consulted, and two prefixes never reach it.
 */
function assertPathUsable(pluginName: string, route: PluginRoute): void {
  if (!route.path.startsWith("/")) {
    throw routeInvalidPathError(pluginName, route.path);
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
 */
function assertUnclaimed(
  seen: readonly ClaimedPattern[],
  claim: ClaimedPattern,
  fullPath: string
): void {
  const clash = seen.find(
    other =>
      other.method === claim.method &&
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

export function collectPluginRoutes(
  plugins: PluginDefinition[]
): CollectedRoute[] {
  const collected: CollectedRoute[] = [];
  const seen: ClaimedPattern[] = [];

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const route of plugin.contributes?.routes ?? []) {
      assertPathUsable(plugin.name, route);
      const fullPath = pluginRouteFullPath(
        plugin.name,
        route.path,
        route.mount
      );
      const segments = splitPath(fullPath);
      const claim: ClaimedPattern = {
        method: route.method,
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

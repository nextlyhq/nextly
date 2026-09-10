/**
 * Paths a root-mounted route would be registered at and never asked about.
 *
 * A root route is consulted where the built-in REST router declines. Two kinds
 * of request never get that far, and a route declared under either would sit in
 * the registry answering nothing:
 *
 *   `/auth/...`   the verb wrappers hand these to the auth router, which
 *                 answers its own 404 rather than falling through.
 *   `/plugins/...` the namespaced mount's own prefix, matched in the earlier
 *                 pass, so a root route there loses to whichever namespaced
 *                 route shares the shape and is never reached when none does.
 *
 * Refused at boot rather than left to fail silently at request time: a plugin
 * author who declares a route and gets no traffic has nothing to look at, and
 * "registered" reads as "working".
 *
 * This is NOT a list of endpoints core serves. Those are handled by the
 * ORDERING -- root routes are asked last, so core always answers first, and no
 * list has to be kept in step with the routes core adds. These two are branches
 * of the request pipeline that return before the fallback exists at all. A
 * third such branch would have to be added here, which is why the reason is
 * written down rather than the paths alone.
 *
 * @module plugins/routes/root-mount-reach
 */

import { PLUGIN_NAMESPACE_SEGMENT } from "./route-path";
import { splitPath } from "./route-pattern";

/** The first segment the auth router claims, as its own dispatcher reads it. */
const AUTH_SEGMENT = "auth";

/**
 * Why a root path is unreachable, or `null` when it is reachable.
 *
 * A reason rather than a boolean, so the error can say which branch takes the
 * request instead of only that something does.
 */
export function rootMountUnreachableReason(path: string): string | null {
  const [first] = splitPath(path);
  if (first === AUTH_SEGMENT) {
    return "the auth router answers every `/auth` request, including the ones it does not recognise, so this route would never be asked";
  }
  if (first === PLUGIN_NAMESPACE_SEGMENT) {
    return "`/plugins` is the namespace mount's own prefix, matched before the built-in router, so a root route there is shadowed by the namespaced pass";
  }
  return null;
}

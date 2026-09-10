/**
 * Paths a root-mounted route would be registered at and never asked about.
 *
 * A root route is consulted where the built-in REST router declines. Some
 * requests never get that far, and a route declared under one of those would
 * sit in the registry answering nothing:
 *
 *   `/auth/...`        the verb wrappers hand these to the auth router, which
 *                      answers its own 404 rather than falling through.
 *   `/plugins/...`     the namespaced mount's own prefix, matched in the
 *                      earlier pass, so a root route there loses to whichever
 *                      namespaced route shares the shape and is never reached
 *                      when none does.
 *   `/admin-meta/...`  answered from the verb wrappers, GET across the whole
 *                      subtree and PATCH on one path.
 *   `/dev-reload`      the development reload stream, from the GET wrapper.
 *   `/_dev/...`        the development schema endpoints, from POST and DELETE.
 *
 * Refused at boot rather than left to fail silently at request time: a plugin
 * author who declares a route and gets no traffic has nothing to look at, and
 * "registered" reads as "working".
 *
 * This is NOT a list of endpoints core serves. Those are handled by the
 * ORDERING -- root routes are asked last, so core always answers first, and no
 * list has to be kept in step with the routes core adds. These are branches of
 * the request pipeline that return before the fallback exists at all, which is
 * a different thing and cannot be fixed by ordering.
 *
 * An earlier version of this list held the first two and said a third would
 * have to be added here. Three already existed. So the list is no longer
 * trusted to be complete by inspection: `root-mount-reach.test.ts` reads the
 * verb wrappers and fails when a branch there has no entry.
 *
 * @module plugins/routes/root-mount-reach
 */

import { PLUGIN_NAMESPACE_SEGMENT } from "./route-path";
import { splitPath } from "./route-pattern";

/**
 * Every first segment a root route can never answer on, and why.
 *
 * Keyed on the first segment because every branch that takes a request early
 * keys on exactly that: `params[0]`, in the verb wrappers, before
 * `handleServiceRequest` is called at all.
 *
 * Method-agnostic on purpose. `admin-meta` is claimed for GET across its whole
 * subtree and for one PATCH path, so it is core's namespace whatever the verb,
 * and a per-method table would be a second thing to keep in step for the sake
 * of letting a plugin claim a verb nobody should want there.
 */
const UNREACHABLE_FIRST_SEGMENTS: Readonly<Record<string, string>> = {
  auth: "the auth router answers every `/auth` request, including the ones it does not recognise, so this route would never be asked",
  [PLUGIN_NAMESPACE_SEGMENT]:
    "`/plugins` is the namespace mount's own prefix, matched before the built-in router, so a root route there is shadowed by the namespaced pass",
  "admin-meta":
    "the admin metadata endpoints answer from the verb wrappers, and the GET branch claims the whole subtree, so the fallback this route waits for is never reached",
  "dev-reload":
    "the development reload stream answers from the GET wrapper before the fallback exists",
  _dev: "the development schema endpoints answer from the POST and DELETE wrappers before the fallback exists",
};

/**
 * Why a root path is unreachable, or `null` when it is reachable.
 *
 * A reason rather than a boolean, so the error can say which branch takes the
 * request instead of only that something does.
 */
export function rootMountUnreachableReason(path: string): string | null {
  const [first] = splitPath(path);
  return UNREACHABLE_FIRST_SEGMENTS[first] ?? null;
}

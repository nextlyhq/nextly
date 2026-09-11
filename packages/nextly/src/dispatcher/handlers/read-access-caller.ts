/**
 * The dispatcher's resolved identity, in the shape the shared read decision
 * takes.
 *
 * `canReadEntity` and `readableEntities` are the one answer to "may this
 * caller read that entity" — the dashboard scope, the version reads and the
 * list endpoints all ask it, so that a collection authorised entirely in code
 * is visible on every one of them or on none. This is the bridge from a
 * dispatcher request to that answer, kept as one address so no handler builds
 * its own caller and quietly asks a different question.
 *
 * DERIVED, not written a third time. `readAuthenticatedScope` already owns the
 * choice between the scope the route handler pinned for the request and the
 * lossy reconstruction from route params, and `readAccessCaller` already turns
 * a scope and a user into the caller the decision reads — the same conversion
 * the dashboard makes. Repeating either here is a copy that agrees today and
 * drifts the day one of them learns a field.
 *
 * @module dispatcher/handlers/read-access-caller
 */

import {
  readAccessCaller,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";
import type { UserContext } from "../../domains/singles/types";
import { readAuthenticatedScope } from "../helpers/authenticated-actor";
import type { Params } from "../types";

export function readAccessCallerForDispatch(
  p: Params,
  user: UserContext
): ReadAccessCaller {
  return readAccessCaller({
    user,
    authenticatedScope: readAuthenticatedScope(p),
  });
}

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  currentCallerScope,
  currentRequestCaller,
} from "../../auth/caller-scope";
import type { RequestActor } from "../../auth/request-actor";

/**
 * The acting identity of the request: who a write is attributed to. The API
 * key itself when one was used, rather than the user that owns it.
 */
export function readAuthenticatedActor(): RequestActor | undefined {
  const actor = currentRequestCaller()?.actor;
  return actor ? { ...actor } : undefined;
}

/**
 * The caller's authenticated scope, for a service-side access re-check.
 *
 * An API key's scope is the one the route handler pinned for the dispatch,
 * whole: the same object every other gate sees, carrying the key's own grants,
 * roles and the rows a rule's permission list is built from, so a
 * service check (e.g. the publish/unpublish transition gate) judges the key on
 * those rather than the owner's RBAC.
 *
 * A session has no scope of its own and is handed an empty one of its actor
 * type, so the API-key branch is skipped and the check resolves the account's
 * grants as it always did. No authenticated caller, no scope.
 */
export function readAuthenticatedScope(): AuthenticatedScope | undefined {
  const pinned = currentCallerScope();
  if (pinned) return pinned;
  const caller = currentRequestCaller();
  return caller ? { actorType: caller.actor.type, permissions: [] } : undefined;
}

/**
 * Whether the route admitted the caller on `update` itself, so a service may
 * skip that re-check. A write route may also admit a caller on publish or
 * unpublish alone, and the service then asks its own gate for the write.
 */
export function routeAdmittedUpdate(): boolean {
  const caller = currentRequestCaller();
  // A visitor the route admitted is no caller: the route vouched for no one,
  // so the service judges the write as the visitor's.
  if (!caller) return false;
  const action = caller.routeAction;
  return action === undefined || action === "update";
}

/**
 * Whether the route authenticated a caller and ran the gate for them, so a
 * service may skip that re-check. A visitor the route admitted is no caller,
 * and the service judges its call as the visitor's.
 */
export function routeVouched(): boolean {
  return currentRequestCaller() !== undefined;
}

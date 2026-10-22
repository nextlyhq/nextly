/**
 * Running dispatcher code as an authenticated REST caller, for unit tests.
 *
 * The route handler sets the request caller, and for an API key pins the
 * key's scope, for the length of a dispatch. A test that drives a handler
 * directly does the same here, so it reaches the identity exactly as a real
 * request's handler does rather than through a copy of its own.
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  runWithCallerScope,
  runWithRequestCaller,
  type RequestCaller,
} from "../../auth/caller-scope";

/** A signed-in session caller, with the given role slugs where any. */
export function sessionCaller(
  fields: Partial<Omit<RequestCaller, "actor">> = {}
): RequestCaller {
  const userId = fields.userId ?? "u1";
  return { ...fields, userId, actor: { type: "user", id: userId } };
}

/** An API-key caller, attributed to the key and acting for its owner. */
export function keyCaller(
  keyId: string,
  fields: Partial<Omit<RequestCaller, "actor">> = {}
): RequestCaller {
  return {
    ...fields,
    userId: fields.userId ?? "u1",
    actor: { type: "apiKey", id: keyId },
  };
}

/**
 * Runs `operation` as `caller`, with `scope` pinned the way the route handler
 * pins an API key's scope. Without a caller, it runs as an anonymous request.
 */
export function asCaller<T>(
  caller: RequestCaller | undefined,
  operation: () => T,
  scope?: AuthenticatedScope
): T {
  return runWithCallerScope(scope, () =>
    runWithRequestCaller(caller, operation)
  );
}

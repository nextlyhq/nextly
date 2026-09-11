/**
 * Pinning the caller's own authorization scope for the length of one request.
 *
 * `ctx.authenticatedScope` makes the key's grants AVAILABLE to a handler, and
 * availability is not enough: every first-party route already written composes
 * `{ as: "user", user: ctx.user }` by hand, so an opt-in field leaves each of
 * them authorizing an API key as its owner exactly as before, and every route
 * written next has to remember. That is a check that looks for crossings where
 * a boundary belongs.
 *
 * So the dispatcher pins the scope for the length of the request instead, and
 * `resolveServiceOpts` reads it when the caller did not pass one. A handler
 * that names the scope explicitly still wins — the ambient value is a floor,
 * not an override — which keeps a route free to narrow it and keeps the
 * existing explicit call sites meaning what they say.
 *
 * `AsyncLocalStorage` rather than a mutable module variable: plugin routes are
 * served concurrently, and a shared variable would hand one request's scope to
 * another. The same reason `field-type-scope.ts` uses it to pin a registry.
 *
 * @module auth/caller-scope
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { AuthenticatedScope } from "./authenticated-scope";

const callerScope = new AsyncLocalStorage<AuthenticatedScope>();

/**
 * Run `operation` with `scope` as the caller scope every service call inside it
 * inherits.
 *
 * A session caller passes `undefined` and nothing is pinned, so the store stays
 * empty and `currentCallerScope()` answers `undefined` — which is what a
 * session must resolve as, since a scope it does not have would narrow it.
 */
export function runWithCallerScope<T>(
  scope: AuthenticatedScope | undefined,
  operation: () => T
): T {
  if (!scope) return operation();
  return callerScope.run(scope, operation);
}

/**
 * The scope pinned for the request currently running, if any.
 *
 * Returns `undefined` where nothing pinned one — a job, the CLI, a direct
 * service call, or a transport that does not yet pin — so nothing acquires a
 * scope it was not given, and a caller that reads this falls back to resolving
 * grants from the account as it always did.
 */
export function currentCallerScope(): AuthenticatedScope | undefined {
  return callerScope.getStore();
}

/**
 * The scope a call operates under: the one it was handed, or the one the
 * request pinned.
 *
 * Published as one function because two callers answering it separately is how
 * a gate and the check backing it up came to disagree: one resolved the
 * ambient scope and the other read only its argument, so a request whose scope
 * arrives through the store alone looked like an API key to the first and like
 * a session to the second — which is exactly when it matters.
 *
 * An explicit argument still wins, so a caller may narrow.
 */
export function effectiveCallerScope(
  explicit: AuthenticatedScope | undefined
): AuthenticatedScope | undefined {
  return explicit ?? currentCallerScope();
}

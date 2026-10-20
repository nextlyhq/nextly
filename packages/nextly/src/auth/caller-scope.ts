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
import { currentPrincipal } from "./principal-scope";
import type { RequestActor } from "./request-actor";

const callerScope = new AsyncLocalStorage<AuthenticatedScope>();

/**
 * Who an authenticated REST request is, as the route handler resolved it.
 *
 * Carried in request context rather than in the route's params. Params are
 * strings a request also fills from its query, so identity written there had
 * to be stripped of client copies first and was rebuilt, lossily, by every
 * reader. One frozen record, set by the one place that authenticated the
 * request, cannot be forged by a query and reads the same everywhere.
 */
export interface RequestCaller {
  readonly userId: string;
  readonly name?: string;
  readonly email?: string;
  /** Verified non-canonical token claims, for rules that decide on them. */
  readonly claims?: Readonly<Record<string, unknown>>;
  /** Who a write is attributed to: the API key itself when one was used. */
  readonly actor: RequestActor;
  /**
   * The caller's role slugs, inherited roles included. Resolved only for the
   * routes whose handlers hand roles to access rules, so the others pay for
   * no role lookup; absent elsewhere.
   */
  readonly roles?: readonly string[];
}

const requestCaller = new AsyncLocalStorage<RequestCaller | undefined>();

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
 * Run `operation` with no caller scope pinned, as if no request were being
 * served. Internal: not part of any published entry point.
 *
 * DANGEROUS outside its two uses. Inside it, a call made for an API-key
 * request no longer inherits the key's narrowing: an access check that names
 * no scope reads none, so the call is judged by the user it names alone, and
 * a key that may do less than its owner is no longer held to less. The only
 * two allowed uses are:
 *
 *   (a) running work exactly as its scheduled job runs it — a job that never
 *       has a request scope, such as the releases drain run by Publish now;
 *   (b) evaluating a NAMED identity's grants, read-only — such as whether a
 *       release member's author may publish it — where the identity being
 *       judged is not the request's caller.
 *
 * Never wrap a write made on the caller's behalf, or a check of the caller's
 * own authority, in it.
 */
export function runDetachedFromRequest<T>(operation: () => T): T {
  return callerScope.exit(() => requestCaller.exit(operation));
}

/**
 * Run `operation` as the request `caller` authenticated, or as no one.
 *
 * Always runs a new context, `undefined` included: a request reached while
 * another is being handled is its own caller, never the outer request's.
 */
export function runWithRequestCaller<T>(
  caller: RequestCaller | undefined,
  operation: () => T
): T {
  return requestCaller.run(caller, operation);
}

/**
 * The authenticated caller of the REST request being dispatched, if any.
 *
 * Nothing outside a REST dispatch sets it, so a job, a script, the Direct API
 * and work detached from the request all answer `undefined`.
 */
export function currentRequestCaller(): RequestCaller | undefined {
  return requestCaller.getStore();
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
  // A call made as a plugin-defined person is that person, not the API key
  // that authenticated the request around it: judged by the key's scope, a
  // person would act with the key's grants.
  if (explicit === undefined && currentPrincipal() !== null) return undefined;
  return explicit ?? currentCallerScope();
}

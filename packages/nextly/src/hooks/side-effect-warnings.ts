/**
 * Request-scoped collection of post-commit hook failures.
 *
 * A side-effect phase (`afterCreate` / `afterUpdate` / `afterDelete`) runs after
 * the transaction has committed, so a handler throwing there cannot un-save the
 * row. The operation therefore reports success, and the failure is reported
 * beside it as a warning: a side effect that silently did not run is the outcome
 * that has to be avoided.
 *
 * The failures are produced deep in the hook registry and consumed at the
 * response boundary, with the whole write path in between. Threading a callback
 * through that path means editing every write path to carry a parameter none of
 * them otherwise needs, and every response builder to forward it. An ambient
 * scope lets the producer stay one line and the consumers stay one function
 * each.
 *
 * @module hooks/side-effect-warnings
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { SideEffectHookFailure } from "./hook-registry";

/**
 * A stack rather than a single collector, because operations nest: a hook may
 * call the Direct API, whose own mutation opens a scope while the request that
 * triggered it is still collecting. Recording into every active collector means
 * the inner call reports its own failures to its caller AND they still reach
 * the response the client is waiting on, without either scope having to know
 * the other exists.
 */
const collectorStack = new AsyncLocalStorage<SideEffectHookFailure[][]>();

/**
 * The public projection of a hook failure.
 *
 * Deliberately not `SideEffectHookFailure`, whose `error` is a `NextlyError`
 * carrying `cause` and `logContext`. Those are private diagnostics —
 * `errorToServiceResult` exists to keep identifier-bearing detail off publicly
 * surfaced shapes — so a client gets the code and the public message, and the
 * full error stays on the collector for the logger.
 */
export interface HookWarning {
  /** The lifecycle phase whose handler failed. */
  phase: string;
  /** The collection or single the handler was registered against. */
  collection: string;
  /** The canonical `NextlyError` code, for a caller branching on the failure. */
  code: string;
  /** The §13.8-compliant public message. Never carries identifiers. */
  message: string;
}

/** Reduce a failure to what may cross a public boundary. */
export function toHookWarning(failure: SideEffectHookFailure): HookWarning {
  return {
    phase: failure.phase,
    collection: failure.collection,
    code: failure.error.code,
    message: failure.error.publicMessage,
  };
}

/**
 * Record a post-commit hook failure against every collector currently active.
 *
 * A no-op when nothing is collecting, which is the case for internal work that
 * has no caller to report to. The failure is logged either way, at the point it
 * is caught, so this never decides whether it is visible at all.
 */
export function recordSideEffectWarning(failure: SideEffectHookFailure): void {
  const stack = collectorStack.getStore();
  if (!stack) return;
  for (const collector of stack) collector.push(failure);
}

/**
 * Run `operation` with a fresh collector, and hand back what it collected
 * alongside the operation's own result.
 *
 * Any collector already active stays active, so an outer request still sees
 * failures raised by work nested inside it.
 */
export async function withSideEffectWarnings<T>(
  operation: () => Promise<T>
): Promise<{ result: T; failures: SideEffectHookFailure[] }> {
  const collected: SideEffectHookFailure[] = [];
  const stack = [...(collectorStack.getStore() ?? []), collected];
  const result = await collectorStack.run(stack, operation);
  return { result, failures: collected };
}

/**
 * What the innermost active collector holds right now.
 *
 * For a consumer that sits inside the scope rather than around it — the
 * response builders read this while still within the request's scope, so they
 * do not have to be handed the array the boundary is filling.
 */
export function currentSideEffectWarnings(): HookWarning[] {
  const stack = collectorStack.getStore();
  const innermost = stack?.[stack.length - 1];
  return (innermost ?? []).map(toHookWarning);
}

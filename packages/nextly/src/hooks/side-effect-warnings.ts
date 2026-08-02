/**
 * Request-scoped diagnostics: what a request collected that its public
 * response cannot carry.
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

import type { NextlyError } from "../errors/nextly-error";

import type { SideEffectHookFailure } from "./hook-registry";

/**
 * A stack rather than a single collector, because operations nest: a hook may
 * call the Direct API, whose own mutation opens a scope while the request that
 * triggered it is still collecting. Recording into every active collector means
 * the inner call reports its own failures to its caller AND they still reach
 * the response the client is waiting on, without either scope having to know
 * the other exists.
 */
interface RequestDiagnostics {
  /** Post-commit hook failures, projected to the caller as warnings. */
  hookFailures: SideEffectHookFailure[];
  /**
   * Typed errors whose private detail the public envelope drops.
   *
   * `errorToServiceResult` deliberately strips `cause` and `logContext` on the
   * way out, because the result shape is publicly surfaced, and the boundary
   * then rebuilds the error from what survived. The original is kept here so
   * the operator gets the full one against the request id, without any of it
   * crossing to the caller.
   */
  flattenedErrors: NextlyError[];
}

/**
 * ONE scope holding both, rather than a buffer each.
 *
 * They share a lifetime and a rule -- collected privately, disclosed only
 * through an explicit projection -- and two stores would each need their own
 * public/private split. Two splits that can disagree about what is safe to
 * disclose is the disclosure bug this exists to prevent.
 */
const collectorStack = new AsyncLocalStorage<RequestDiagnostics[]>();

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
  /**
   * The registry key the handler was registered against.
   *
   * A collection's slug, or `single:<slug>` for a single. Namespaced rather
   * than bare because a collection and a single may share a slug, and a
   * consumer reacting to the warning has to know which one it came from.
   */
  collection: string;
  /** The canonical `NextlyError` code, for a caller branching on the failure. */
  code: string;
  /** The §13.8-compliant public message. Never carries identifiers. */
  message: string;
  /**
   * The row whose side effect failed, when the phase knows it.
   *
   * The caller supplied this id or is being handed it back in the same
   * response, so it discloses nothing new — and without it a bulk caller
   * cannot tell which of its durable rows to remediate.
   */
  entryId?: string;
}

/** Reduce a failure to what may cross a public boundary. */
export function toHookWarning(failure: SideEffectHookFailure): HookWarning {
  return {
    phase: failure.phase,
    collection: failure.collection,
    code: failure.error.code,
    message: failure.error.publicMessage,
    ...(failure.entryId ? { entryId: failure.entryId } : {}),
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
  for (const scope of stack) scope.hookFailures.push(failure);
}

/**
 * Keep a typed error's private detail for the log, before the envelope drops it.
 *
 * A no-op outside a request, where there is no response for the detail to be
 * missing from. Never reaches a caller: nothing projects this list.
 */
export function recordFlattenedError(error: NextlyError): void {
  const stack = collectorStack.getStore();
  if (!stack) return;
  for (const scope of stack) scope.flattenedErrors.push(error);
}

/**
 * The errors this request flattened, for the boundary that logs them.
 *
 * Returned unprojected on purpose: the only caller is the logger, and a
 * projection here would defeat the reason they are kept.
 */
export function currentFlattenedErrors(): NextlyError[] {
  const stack = collectorStack.getStore();
  return stack?.[stack.length - 1]?.flattenedErrors ?? [];
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
  const scope: RequestDiagnostics = { hookFailures: [], flattenedErrors: [] };
  const stack = [...(collectorStack.getStore() ?? []), scope];
  const result = await collectorStack.run(stack, operation);
  return { result, failures: scope.hookFailures };
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
  return (innermost?.hookFailures ?? []).map(toHookWarning);
}

/**
 * Run a write and hand back the post-commit hook failures it collected.
 *
 * The scope opens here because a Direct API call is its own operation boundary
 * -- there is no request around it to open one. A scope already open (the call
 * came from inside a request, or from another collection's hook) still receives
 * the same failures, so an in-process call cannot hide one from the client
 * waiting on the request that triggered it.
 */
export async function collectingWarnings<T>(
  operation: () => Promise<T>
): Promise<{ result: T; warnings?: HookWarning[] }> {
  const { result, failures } = await withSideEffectWarnings(operation);
  return failures.length > 0
    ? { result, warnings: failures.map(toHookWarning) }
    : { result };
}

/**
 * Write a request's flattened-error diagnostics to the operator log.
 *
 * Shared by every request boundary so they cannot disagree about the shape or
 * about the guard. Failures writing them are swallowed: this is observability,
 * and a logger that throws must not replace a response the handler already
 * produced. Losing a log line is recoverable; turning a completed write into a
 * 500 is not.
 */
/**
 * Codes an operator does not want a line for.
 *
 * A missing row, a rate limit and an unauthenticated probe are expected
 * traffic, not faults, and the dispatcher already suppresses them for its own
 * error log. Writing them here would flood the same log through a second door
 * and undo that policy.
 */
const BENIGN_CODES: ReadonlySet<string> = new Set([
  "NOT_FOUND",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
]);

export function logFlattenedErrors(
  errors: readonly NextlyError[],
  write: (entry: Record<string, unknown>) => void,
  context: { requestId: string; route?: string; method?: string }
): void {
  for (const error of errors) {
    if (BENIGN_CODES.has(String(error.code))) continue;
    try {
      write({
        kind: "flattened-service-error",
        ...error.toLogJSON(context.requestId),
        ...(context.route !== undefined ? { route: context.route } : {}),
        ...(context.method !== undefined ? { method: context.method } : {}),
      });
    } catch {
      // Deliberately swallowed; see above.
    }
  }
}

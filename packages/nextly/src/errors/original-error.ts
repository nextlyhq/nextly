/**
 * Carrying the thrown error alongside the public envelope built from it.
 *
 * A service converts a `NextlyError` into a result shape that is publicly
 * surfaced, which means dropping `cause` and `logContext` — and the boundary
 * then rebuilds an error from what survived. The rebuilt one is correct for the
 * caller and useless for debugging: the driver error underneath, and the
 * identifiers the thrower attached, are already gone.
 *
 * The original rides along under a symbol key. A symbol is invisible to
 * `JSON.stringify` and `Object.keys`, so nothing here can reach a response
 * body, and it is ENUMERABLE on purpose: the services build their results with
 * `{ ...errorToServiceResult(...) }`, and spread copies only enumerable own
 * properties — a non-enumerable one would be silently dropped at exactly the
 * call sites this exists for.
 *
 * Deliberately not matched out of the request-scoped diagnostics collector.
 * That would pick an error by code and hope it is the right one; this is the
 * actual object.
 *
 * @module errors/original-error
 */

/** Where the pre-envelope error hides on a service result. */
export const ORIGINAL_ERROR = Symbol.for("nextly.originalError");

/**
 * Any `Error`, not only a `NextlyError`.
 *
 * A raw driver rejection is the case where the chained cause is worth the most
 * — it is the only thing that names the constraint or the connection failure —
 * and it is exactly the shape that never reaches the typed branch.
 */
/** A result that may be carrying the error it was built from. */
interface MaybeCarryingOriginal {
  [ORIGINAL_ERROR]?: Error;
}

/**
 * Attach the thrown error to the envelope built from it.
 *
 * Returns the same object rather than a copy, so a caller spreading the result
 * keeps the property.
 */
export function withOriginalError<T extends object>(
  result: T,
  error: Error
): T {
  Object.defineProperty(result, ORIGINAL_ERROR, {
    value: error,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return result;
}

/** The error an envelope was built from, when it still has it. */
export function originalErrorOf(result: unknown): Error | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  return (result as MaybeCarryingOriginal)[ORIGINAL_ERROR];
}

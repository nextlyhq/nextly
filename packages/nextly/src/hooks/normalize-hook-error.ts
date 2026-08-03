/**
 * Turning whatever a hook threw into the error a boundary should see.
 *
 * Shared by both hook paths -- the runtime registry and the stored, UI
 * configured executor -- because a rejection means the same thing whichever
 * way the hook was declared, and a second copy of this classification is free
 * to drift from the first.
 *
 * @module hooks/normalize-hook-error
 */
import { NextlyError } from "../errors/nextly-error";

/**
 * A short description of a value a hook threw that was not an Error.
 *
 * `String()` is not total: a null-prototype object has no `toString`, and a
 * symbol throws on implicit conversion. Either would turn recording a
 * diagnostic into a second failure that replaces the first, so the conversion
 * is attempted and its own failure falls back to the type name.
 */
/**
 * Whether a thrown value is an Error, without letting the check itself throw.
 *
 * `instanceof` consults the prototype chain, which a revoked proxy refuses.
 */
function isErrorInstance(value: unknown): boolean {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function describeThrown(value: unknown): string {
  try {
    return String(value);
  } catch {
    return `<unstringifiable ${typeof value}>`;
  }
}

export function normalizeHookError(
  error: unknown,
  hookType: string,
  collection: string,
  /** Extra log context identifying which hook, when the caller knows. */
  extra?: Record<string, unknown>
): unknown {
  // Even asking whether this is a typed error can fail: reading the brand off
  // a revoked proxy, or one whose getter throws, raises from the inspection
  // itself. A failure to classify is not a reason to lose the report, so it
  // falls through to the internal error below.
  let typed = false;
  try {
    typed = NextlyError.is(error);
  } catch {
    typed = false;
  }
  if (typed) {
    return error;
  }
  const isError = isErrorInstance(error);
  return NextlyError.internal({
    cause: isError ? (error as Error) : undefined,
    logContext: {
      reason: "hook-execution-failed",
      hookType,
      collection,
      ...(isError ? {} : { thrown: describeThrown(error) }),
      ...extra,
    },
  });
}

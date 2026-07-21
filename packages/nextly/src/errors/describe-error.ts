/**
 * Developer-facing rendering of a thrown value.
 *
 * `NextlyError.message` is deliberately the public message, so anything that
 * renders a caught error with `error.message` shows the generic wire text
 * ("An unexpected error occurred.") and drops the code, the cause and the log
 * context. That is the correct behaviour on the wire and the wrong behaviour
 * on an operator channel: a server log or a terminal.
 *
 * This builds the operator view instead, pulling the structured fields that
 * identify the failure. Stack traces are deliberately excluded — they are the
 * noisy part, and callers that want them render `cause.stack` behind a flag.
 *
 * @module errors/describe-error
 */

import { NextlyError } from "./nextly-error";

/**
 * How far to walk a `cause` chain.
 *
 * The database path alone nests four deep (NextlyError -> DbError ->
 * DrizzleQueryError -> driver error), and it is the DEEPEST link that names the
 * actual fault: the driver says "no such column: localized" while every wrapper
 * above it says only "Failed query". Stopping short drops the one segment worth
 * reading. Repeated messages are collapsed, so the extra depth costs nothing
 * when wrappers merely echo each other.
 */
const MAX_CAUSE_DEPTH = 4;

/**
 * Render an unknown value as a single line, without throwing.
 *
 * Falls back through JSON so a plain object cause (some drivers reject with
 * one) still contributes signal rather than "[object Object]".
 */
function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    // JSON.stringify returns undefined for functions and symbols; fall through
    // to the type tag rather than stringifying an object into "[object Object]".
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular or otherwise unserialisable: the type tag still beats nothing.
  }
  return Object.prototype.toString.call(value);
}

/**
 * Append `cause: …` segments, walking nested causes up to the depth cap.
 *
 * Repeated messages are skipped. A wrapper that re-uses its inner error's text
 * is the norm rather than the exception (a DbError wrapping a driver error
 * carries the same string), and echoing it twice doubles the length of an
 * already-long line without adding signal.
 */
function collectCauses(
  cause: unknown,
  parts: string[],
  depth: number,
  seen: Set<string>
): void {
  if (cause === undefined || cause === null || depth >= MAX_CAUSE_DEPTH) return;
  const message =
    cause instanceof Error ? cause.message : stringifyUnknown(cause);
  if (message && !seen.has(message)) {
    seen.add(message);
    parts.push(`cause: ${message}`);
  }
  if (cause instanceof Error) {
    collectCauses(cause.cause, parts, depth + 1, seen);
  }
}

/**
 * The thrown value's own message, with no cause chain appended.
 *
 * Use this, never `describeError`, when the result feeds a decision. Code that
 * asks "is this the benign 'already exists' case?" by substring match must see
 * only the immediate failure: `describeError` concatenates the whole chain, so
 * an unrelated error that merely *wraps* something containing the phrase would
 * match and be swallowed. Descriptions are for reading; this is for branching.
 *
 * Substring-matching a driver message is itself a weak test. It is preserved
 * here because replacing it is a separate change, but new code should prefer a
 * structured signal such as `DbError.kind`.
 */
export function immediateMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return stringifyUnknown(error);
}

/**
 * Build a developer-readable description of any thrown value.
 *
 * For a `NextlyError` this is `[CODE] public message | cause: … | context: {…}`.
 * For a plain `Error` it is the message plus any cause chain. For anything else
 * it is a best-effort stringification.
 */
export function describeError(error: unknown): string {
  if (NextlyError.is(error)) {
    const parts: string[] = [`[${String(error.code)}] ${error.publicMessage}`];
    // logMessage is the operator-facing headline the factories set (e.g.
    // "Database error"); it is dropped from the wire, so surface it here when
    // it says something the public message does not.
    if (error.logMessage && error.logMessage !== error.publicMessage) {
      parts.push(error.logMessage);
    }
    const seen = new Set<string>([error.publicMessage]);
    collectCauses(error.cause, parts, 0, seen);
    const ctx = error.logContext;
    if (ctx && Object.keys(ctx).length > 0) {
      try {
        parts.push(`context: ${JSON.stringify(ctx)}`);
      } catch {
        // Drop unprintable context rather than mask the rest of the line.
      }
    }
    return parts.join(" | ");
  }

  if (error instanceof Error) {
    const parts: string[] = [error.message];
    collectCauses(error.cause, parts, 0, new Set([error.message]));
    return parts.join(" | ");
  }

  return stringifyUnknown(error);
}

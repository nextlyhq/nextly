/**
 * Shared helpers for building validation issues: JSON-Pointer construction and
 * bounded rendering of untrusted values into messages.
 *
 * They live apart from the validators that use them so document validation and
 * style validation can each import them without importing each other.
 */

/** Escape a JSON-Pointer reference token (RFC 6901: `~` → `~0`, `/` → `~1`). */
function escapePointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Join a parent pointer with a child token. */
export function pointer(parent: string, token: string | number): string {
  return `${parent}/${escapePointer(String(token))}`;
}

/** Longest untrusted string echoed into an issue message. */
const MAX_MESSAGE_VALUE_LENGTH = 120;

/**
 * A safe, bounded string form of an untrusted value for issue messages.
 * Validation inspects data that may not match the declared types, so values are
 * widened to `unknown` at the point of reading and rendered here without: (a)
 * calling a possibly-throwing `toString` (objects/arrays become a short label,
 * never serialized — a deep value would overflow JSON.stringify anyway), or (b)
 * embedding an unbounded string, which an oversized malformed field could use
 * to force huge allocations. Long strings are truncated.
 */
export function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > MAX_MESSAGE_VALUE_LENGTH
      ? `${value.slice(0, MAX_MESSAGE_VALUE_LENGTH)}…`
      : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return Array.isArray(value) ? "[array]" : "[object]";
}

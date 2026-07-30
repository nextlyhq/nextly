/**
 * Preparing a value for a JSON-backed column.
 *
 * Every write path classifies a field as JSON and then encodes it, and each one
 * had grown its own copy of the encoding. They agreed on objects and disagreed
 * on everything else: a scalar was left untouched, so a valid JSON value such
 * as `true` or `42` reached the driver unencoded. On SQLite, where a JSON
 * column is plain text, that binds a boolean to a text column and reads back as
 * something other than what was written.
 *
 * @module shared/lib/json-column-value
 */

/** What a value turned into, and whether it was a string that is not JSON. */
export interface JsonColumnValue {
  value: unknown;
  /**
   * The value was already a string but does not parse as JSON. Left exactly as
   * given — re-encoding it would double-serialize content a previous write
   * stored — and reported so a caller can say so.
   */
  invalidJsonString: boolean;
}

/**
 * Encode `value` for a JSON column.
 *
 * `null` and `undefined` are returned untouched: the column is nullable and the
 * callers already skip them, so encoding them here would write the string
 * `"null"` where a real SQL NULL belongs.
 */
export function toJsonColumnValue(value: unknown): JsonColumnValue {
  if (value === null || value === undefined) {
    return { value, invalidJsonString: false };
  }

  if (typeof value === "string") {
    try {
      JSON.parse(value);
      // Already encoded by an earlier write or by the caller; re-encoding would
      // wrap it in quotes and change what is stored.
      return { value, invalidJsonString: false };
    } catch {
      return { value, invalidJsonString: true };
    }
  }

  // Objects, arrays, booleans and numbers all encode the same way. A boolean
  // and a number are legal JSON documents in their own right, which is why they
  // belong here rather than being passed through as the driver's own types.
  return { value: JSON.stringify(value), invalidJsonString: false };
}

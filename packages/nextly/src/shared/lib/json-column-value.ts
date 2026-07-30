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
 * A string is the one input the value alone cannot classify: it may be a
 * document an earlier step encoded, or the logical string the caller means to
 * store. Whether it parses is the only signal available, and it is a heuristic
 * — a logical string that happens to look like JSON is read as a document. What
 * is NOT ambiguous is a string that does not parse: nothing can read it as an
 * encoded document, so writing it raw is wrong under either meaning.
 *
 * @module shared/lib/json-column-value
 */

/**
 * Encode `value` for a JSON column.
 *
 * `null` and `undefined` are returned untouched: the column is nullable and the
 * callers already skip them, so encoding them here would write the string
 * `"null"` where a real SQL NULL belongs.
 */
export function toJsonColumnValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    try {
      JSON.parse(value);
      // Parses, so it is taken as a document an earlier step already encoded.
      // Re-encoding would wrap it in quotes and change what is stored.
      return value;
    } catch {
      // Does not parse, so it is not an encoded document and there is nothing
      // to double-encode. Written raw it puts bare text where the column holds
      // JSON, which Postgres and MySQL reject outright; encoding it stores the
      // string the caller actually had.
      return JSON.stringify(value);
    }
  }

  // Objects, arrays, booleans and numbers all encode the same way. A boolean
  // and a number are legal JSON documents in their own right, which is why they
  // belong here rather than being passed through as the driver's own types.
  return JSON.stringify(value);
}

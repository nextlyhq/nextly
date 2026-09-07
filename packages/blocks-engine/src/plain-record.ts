/**
 * Whether a value is a plain record: an object with named keys and nothing
 * else, as JSON produces and as a stored document is made of.
 *
 * The prototype is what decides. "Not an array" is the obvious test and it
 * lets every other exotic object through — a `Date`, a `Map`, a class
 * instance — each of which has no own enumerable keys, so a walk over it finds
 * nothing and reports the value clean. The document then goes through JSON on
 * its way to storage, where a `Date` becomes a string and a `Map` becomes
 * `{}`, and the same validator refuses on the next read what it accepted on
 * the way in. Validating what will actually be stored is the point.
 *
 * A null prototype is accepted alongside `Object.prototype`: an object built
 * with `Object.create(null)` is a record in every sense that matters here, and
 * refusing it would reject a shape that survives JSON unchanged.
 */
export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  if (notAnObject(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * The part of {@link isPlainRecord} that runs no user code, for callers that
 * cannot afford to run any yet.
 *
 * It answers `true` only when the value is a record under NO reading — a
 * primitive, `null`, an array — and `false` for everything whose record-ness
 * only the prototype can settle. So it can refuse earlier than
 * {@link isPlainRecord} and can never ACCEPT something that would go on to be
 * refused: `definitelyNotARecord(v)` implies `!isPlainRecord(v)`, which is the
 * property that makes two readings of one question safe to have.
 *
 * Here rather than at the caller, beside the answer it under-approximates.
 * Both readings share {@link notAnObject}, so the clause they agree on has one
 * implementation and cannot drift; a copy at the call site would agree until
 * one of them learned about a shape the other did not.
 *
 * `Array.isArray` runs no trap, but it reads the array brand THROUGH a proxy
 * and a revoked one throws rather than answering. A value that cannot say
 * whether it is an array cannot be refused on the strength of the question, so
 * the throw resolves to "not certainly a non-record" and the caller's later,
 * fuller reading decides.
 */
export function definitelyNotARecord(value: unknown): boolean {
  if (notAnObject(value)) return true;
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * The cheap half of both readings: a value that is not an object at all cannot
 * be a record, and finding that out runs nothing.
 *
 * Separate so the two readings above state it once. `typeof null` is
 * `"object"`, which is why the null test is not redundant.
 */
function notAnObject(value: unknown): boolean {
  return typeof value !== "object" || value === null;
}

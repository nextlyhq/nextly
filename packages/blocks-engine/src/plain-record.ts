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
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

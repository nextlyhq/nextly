/**
 * Whether a value is JSON as it will be read back: nothing lost or changed.
 *
 * Strings, finite numbers, booleans, null, arrays and plain objects of
 * those. A `Date`, a `Map`, a class instance, `undefined`, a `bigint`, a
 * function or a non-finite number is not: each is dropped, rewritten or
 * refused by a JSON round trip, and neither is an array with holes, which
 * JSON writes as nulls. A value that contains itself is not either, and is
 * answered rather than recursed into forever.
 *
 * @module shared/lib/json-value
 */

export function isJsonValue(value: unknown): boolean {
  return isJsonWithin(value, new Set());
}

/** `value` is JSON, its containers not met before on the way down. */
function isJsonWithin(value: unknown, above: Set<object>): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (above.has(value)) return false;
  if (Array.isArray(value)) {
    // `Object.values` skips holes, which JSON fills with null.
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
  }
  above.add(value);
  const fits = Object.values(value).every(item => isJsonWithin(item, above));
  above.delete(value);
  return fits;
}

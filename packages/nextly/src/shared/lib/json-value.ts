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

/** Whether a JSON leaf: a string, a finite number, a boolean or null. */
function isJsonLeaf(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return (
    value === null || typeof value === "string" || typeof value === "boolean"
  );
}

/**
 * Whether `value` is a container JSON keeps as it is: an array with no hole
 * (`Object.values` skips one, and JSON fills it with null), or a plain object.
 */
function isJsonContainer(value: object): boolean {
  if (!Array.isArray(value)) {
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

/** `value` is JSON, its containers not met before on the way down. */
function isJsonWithin(value: unknown, above: Set<object>): boolean {
  if (isJsonLeaf(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  if (above.has(value) || !isJsonContainer(value)) return false;
  above.add(value);
  const fits = Object.values(value).every(item => isJsonWithin(item, above));
  above.delete(value);
  return fits;
}

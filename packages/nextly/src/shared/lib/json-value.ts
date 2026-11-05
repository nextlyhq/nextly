/**
 * Whether a value is JSON as it will be read back: nothing lost or changed.
 *
 * Decided by the round trip itself rather than by listing what JSON cannot
 * hold: the value is written as JSON and read back, and must come back
 * equal in every part. Anything a round trip refuses (a bigint, a value that
 * contains itself) or changes (a `Date`, a `Map`, a class instance,
 * `undefined`, a function, a non-finite number, an array with a hole or a
 * named property, a getter, a symbol key, a non-enumerable property) is not
 * JSON.
 *
 * @module shared/lib/json-value
 */

export function isJsonValue(value: unknown): boolean {
  let written: string | undefined;
  try {
    written = JSON.stringify(value);
  } catch {
    return false;
  }
  if (written === undefined) return false;
  return comesBackEqual(value, JSON.parse(written));
}

/** Whether `read`, parsed back from `value`'s JSON, equals it in every part. */
function comesBackEqual(value: unknown, read: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return Object.is(value, read);
  }
  if (read === null || typeof read !== "object") return false;
  if (Array.isArray(value) !== Array.isArray(read)) return false;
  if (!isPlainContainer(value)) return false;
  const keys = Object.keys(value);
  const readKeys = Object.keys(read);
  if (keys.length !== readKeys.length) return false;
  return keys.every(
    key =>
      Object.hasOwn(read, key) &&
      comesBackEqual(
        (value as Record<string, unknown>)[key],
        (read as Record<string, unknown>)[key]
      )
  );
}

/**
 * Whether `value` holds only what JSON writes: an array or a plain object
 * whose own properties are all enumerable data properties under string keys,
 * and, for an array, its indices and nothing else.
 */
function isPlainContainer(value: object): boolean {
  if (!Array.isArray(value)) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
  }
  const own = Reflect.ownKeys(value);
  for (const key of own) {
    if (typeof key !== "string") return false;
    if (Array.isArray(value) && key === "length") continue;
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !("value" in property)) return false;
    if (Array.isArray(value) && String(Number(key)) !== key) return false;
  }
  // Every index present: JSON writes a hole as null.
  return !Array.isArray(value) || own.length === value.length + 1;
}

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

/** Whether `value` is an array or a plain object, not a class's instance. */
function hasPlainShape(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether `key` is a property JSON writes as it is: an enumerable data
 * property under a string key, and for an array, one of its indices.
 */
function isWrittenProperty(value: object, key: string | symbol): boolean {
  if (typeof key !== "string") return false;
  if (Array.isArray(value)) {
    if (key === "length") return true;
    if (String(Number(key)) !== key) return false;
  }
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property?.enumerable === true && "value" in property;
}

/**
 * Whether `value` holds only what JSON writes: an array or a plain object
 * whose own properties are all written as they are, and, for an array, no
 * hole, which JSON writes as null.
 */
function isPlainContainer(value: object): boolean {
  if (!hasPlainShape(value)) return false;
  const own = Reflect.ownKeys(value);
  if (!own.every(key => isWrittenProperty(value, key))) return false;
  return !Array.isArray(value) || own.length === value.length + 1;
}

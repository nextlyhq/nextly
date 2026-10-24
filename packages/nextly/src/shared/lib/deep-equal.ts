/**
 * Whether two JSON-serializable values are the same value: ONE comparison for
 * the webhook envelope's changed fields and the activity trail's reading of
 * what a write changed, so the two cannot disagree about it.
 *
 * @module shared/lib/deep-equal
 */

/**
 * Structural deep-equal for JSON-serializable values (null, primitives,
 * arrays, plain objects). Used to decide whether a top-level field's value
 * actually changed. Key order is irrelevant; array order is significant.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  // Dates have no enumerable keys, so the object branch below would treat any
  // two of them as equal; compare by instant instead. A date-only change must
  // still register in changedFields.
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    k => Object.hasOwn(bObj, k) && deepEqual(aObj[k], bObj[k])
  );
}

/**
 * Whether two values in the editor are the same value: what a restore asks
 * when it lists the fields a version changes, and again when the save names
 * the fields still holding what was restored. One answer for both.
 *
 * @module components/features/versions/same-form-value
 */

/**
 * Whether two form values are the same value: structural, key order aside,
 * array order kept. Values the form draws blank (absent, null, an empty
 * string, list or group) are all the same empty value.
 */
export function sameFormValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Two values the form draws blank are the same: an empty group the version
  // never held is no change from one the form fills with empty inputs.
  if (isBlank(a) && isBlank(b)) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => sameFormValue(item, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameFormValue(left[key], right[key])) return false;
  }
  return true;
}

/** Whether the form draws a value blank: nothing in it holds a value. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isBlank);
  }
  return false;
}

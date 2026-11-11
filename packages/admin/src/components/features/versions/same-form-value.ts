/**
 * Whether two values in the editor are the same value: what a restore asks
 * when it lists the fields a version changes, and again when the save names
 * the fields still holding what was restored. One answer for both.
 *
 * @module components/features/versions/same-form-value
 */

/**
 * Whether two form values are the same value: structural, key order aside,
 * array order kept. An absent value and null are the same empty value, as the
 * form renders both blank.
 */
export function sameFormValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
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

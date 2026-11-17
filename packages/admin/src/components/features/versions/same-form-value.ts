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
  // Two values the form draws blank are the same: an empty group the version
  // never held is no change from one the form fills with empty inputs.
  return sameStructure(a, b, isBlank);
}

/**
 * Two values structurally, key order aside, array order kept, with any two
 * values `empty` names taken as the same. The one walk both readings share.
 */
function sameStructure(
  a: unknown,
  b: unknown,
  empty: (value: unknown) => boolean
): boolean {
  if (a === b) return true;
  if (empty(a) && empty(b)) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, i) => sameStructure(item, b[i], empty))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameStructure(left[key], right[key], empty)) return false;
  }
  return true;
}

/**
 * Whether two values of one field are the same value, as the field holds them:
 * `sameFormValue`, except where the field's type says more.
 *
 * - A JSON field stores what it is given, so its distinct empty values (`""`,
 *   `[]`, `{}`) are different values; only absent and null are the same
 *   nothing.
 * - A relationship or upload names documents: the version holds each by its
 *   id, the editor may hold the document itself, so each is compared by the
 *   id it names.
 */
export function sameFieldValue(
  type: string | undefined,
  a: unknown,
  b: unknown
): boolean {
  if (type === "json") return sameJsonValue(a, b);
  if (type === "relationship" || type === "upload") {
    return sameFormValue(referencesOf(a), referencesOf(b));
  }
  return sameFormValue(a, b);
}

/** Two JSON values, structurally, key order aside; only absent and null alike. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  return sameStructure(a, b, value => value == null);
}

/**
 * A relationship's value with each document it names read as its id: a
 * populated document (`{ id, ... }`) as its id, a reference to one of several
 * collections (`{ relationTo, value }`) with its value read the same way.
 *
 * A populated row is told apart first: the document it names may have fields
 * called `relationTo` and `value` of its own, which shape it like such a
 * reference. A row carries an id and a reference does not, so only a value
 * without one is read as a reference.
 */
function referencesOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(referencesOf);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (
    !("id" in record) &&
    typeof record.relationTo === "string" &&
    "value" in record
  ) {
    return { relationTo: record.relationTo, value: referencesOf(record.value) };
  }
  return "id" in record ? record.id : value;
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

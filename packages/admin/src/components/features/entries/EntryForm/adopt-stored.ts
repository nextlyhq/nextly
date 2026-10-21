/**
 * Making what the server stored the form's new starting point after a save.
 *
 * The form's defaults are what "unsaved" is measured against, and what any
 * surface judging the stored document — a lock's baseline among them — reads.
 * Reset to what was SENT, a value the server normalised on the way in stays on
 * screen as sent and the defaults disagree with the stored row. Reset to what
 * was STORED, but blindly, and whatever the author typed while the save was in
 * flight is wiped. This does the first without the second.
 *
 * @module components/features/entries/EntryForm/adopt-stored
 */
import type { UseFormReturn } from "react-hook-form";

/**
 * Whether two form values are the same value, by structure: a field's value
 * may be an object or an array (a group, a repeater, a blocks document), and
 * the form hands back a fresh copy of it, so identity says nothing.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) return sameArray(a, b);
  return isRecord(a) && isRecord(b) && sameRecord(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Element by element, and the same length; an array and a non-array differ. */
function sameArray(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => sameValue(item, b[index]));
}

/** Key by key, across the keys of both, so a missing key differs. */
function sameRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => sameValue(a[key], b[key]));
}

/**
 * Resets the form to `stored`, the server's values in the form's shape, then
 * puts back every field the author changed since `submitted` (the values the
 * save was made from), still counted as unsaved.
 *
 * Compared field by field at the top level: a group or repeater edited while
 * the save was in flight is kept whole, which keeps the edit at the cost of
 * whatever the server normalised inside that one field.
 */
export function adoptStoredValues(
  form: UseFormReturn<Record<string, unknown>>,
  stored: Record<string, unknown>,
  submitted: Record<string, unknown>
): void {
  const current = form.getValues();
  const changedSince = Object.keys(current).filter(
    name => !sameValue(current[name], submitted[name])
  );
  form.reset(stored);
  for (const name of changedSince) {
    form.setValue(name, current[name], { shouldDirty: true });
  }
}

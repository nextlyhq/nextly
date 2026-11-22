/**
 * Whether what a check found for a page differs from the page's row as
 * stored, apart from when it was checked: a check that finds a page as it
 * was leaves the page's row alone, so a page row's `checkedAt` says when a
 * check last found something about the page change.
 *
 * @module problems/row-change
 */
import { isRecord } from "../plain-values";

/**
 * Whether two JSON values hold the same: objects by their keys and values,
 * in any order, as MySQL's JSON columns give keys back in an order of their
 * own; arrays item by item, in order; anything else by value.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, at) => sameJson(item, b[at]))
    );
  }
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return a === b;
}

/** `value` as storing it gives it back: a key with no value is left out. */
function asStored(value: unknown): unknown {
  return value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as unknown);
}

/** Stored JSON text, read; nothing where it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Whether the row a check found, `found`, holds what the row `stored` does
 * in every field it writes but `checkedAt`. A JSON field the store gives back
 * as text is read first, and a field it gives back empty is a null.
 */
export function rowUnchanged(
  found: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>
): boolean {
  return Object.entries(found).every(([field, value]) => {
    if (field === "checkedAt") return true;
    const written = asStored(value);
    const kept = stored[field] ?? null;
    return sameJson(
      written,
      typeof kept === "string" &&
        typeof written === "object" &&
        written !== null
        ? parsed(kept)
        : kept
    );
  });
}

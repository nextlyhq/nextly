/**
 * The text at a unit's address in a document, and a document with that one text replaced.
 *
 * A row is found by its saved id, by the one rule a language's text is kept by (`rowKeys`): the
 * first row of the list holding it, and never by position. A document is never changed: replacing
 * a text copies the way down to it and shares the rest.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/unit-value
 */

import { parsedValue } from "../../../shared/lib/json-column-value";
import { isPlainObject } from "../../../shared/lib/plain-copy";
import { rowKeys } from "../shared-structure";

import type { UnitAddress, UnitSegment } from "./unit-address";

/** What stands at an address: nothing there at all, or a value, blank or not. */
export type UnitValue =
  | { readonly found: false }
  | { readonly found: true; readonly value: unknown };

const NOT_FOUND: UnitValue = { found: false };

/** Where the row with `id` stands in a list, or -1. */
function rowIndex(list: readonly unknown[], id: string): number {
  return rowKeys(list).indexOf(id);
}

/** What one segment leads to from `from`, which may be JSON text. */
function stepInto(from: unknown, segment: UnitSegment): UnitValue {
  const value = parsedValue(from);
  if ("field" in segment) {
    return isPlainObject(value) && Object.hasOwn(value, segment.field)
      ? { found: true, value: value[segment.field] }
      : NOT_FOUND;
  }
  // A block declares no translatable text yet, so none is found.
  if ("node" in segment || !Array.isArray(value)) return NOT_FOUND;
  const index = rowIndex(value, segment.row);
  return index === -1 ? NOT_FOUND : { found: true, value: value[index] };
}

/** The value at `address` in `document`. */
export function unitValueIn(
  document: Readonly<Record<string, unknown>>,
  address: UnitAddress
): UnitValue {
  let at: UnitValue = { found: true, value: document };
  for (const segment of address) {
    if (!at.found) return NOT_FOUND;
    at = stepInto(at.value, segment);
  }
  return at;
}

/**
 * Whether the text at `address` was left out of `document`, as a read leaves out one the caller may
 * not read: what would hold it is there, and it is not. Not one whose row is gone, nor one in a
 * group nothing was ever written in.
 */
export function unitWithheld(
  document: Readonly<Record<string, unknown>>,
  address: UnitAddress
): boolean {
  let at: unknown = document;
  for (const segment of address) {
    const next = stepInto(at, segment);
    if (!next.found) {
      return "field" in segment && isPlainObject(parsedValue(at));
    }
    at = next.value;
  }
  return false;
}

/** {@link withUnitValue} from one value down, or `undefined` where the way is not there. */
function replaced(
  from: unknown,
  rest: readonly UnitSegment[],
  text: unknown
): { value: unknown } | undefined {
  const [segment, ...after] = rest;
  if (segment === undefined) return { value: text };
  const value = parsedValue(from);
  if ("field" in segment) {
    // A group holds one value and no row of its own, so one nothing was ever
    // written in is written as a new one; its text has no other place.
    const level = value === null || value === undefined ? {} : value;
    if (!isPlainObject(level)) return undefined;
    const inner = replaced(level[segment.field], after, text);
    return inner && { value: { ...level, [segment.field]: inner.value } };
  }
  if ("node" in segment || !Array.isArray(value)) return undefined;
  return replacedInRow(value, segment.row, after, text);
}

/** {@link replaced} in the row of `value` with `id`. */
function replacedInRow(
  value: readonly unknown[],
  id: string,
  after: readonly UnitSegment[],
  text: unknown
): { value: unknown } | undefined {
  const index = rowIndex(value, id);
  if (index === -1) return undefined;
  const inner = replaced(value[index], after, text);
  return (
    inner && {
      value: value.map((row: unknown, at) =>
        at === index ? inner.value : row
      ),
    }
  );
}

/**
 * The field `address` starts in, with the text at the address replaced: what a save of that one
 * text sends. `undefined` where the document no longer has the row the text belongs to, or the
 * value there is not one the address leads through: the text has no place to go.
 */
export function withUnitValue(
  document: Readonly<Record<string, unknown>>,
  address: UnitAddress,
  text: unknown
): { field: string; value: unknown } | undefined {
  const [{ field }, ...rest] = address;
  const found = replaced(document[field], rest, text);
  return found && { field, value: found.value };
}

/**
 * Where one translatable text of a document is: the address of a unit of translation work.
 *
 * An address is the way down to the text, from the document's own field: a field by its name, a
 * row (or a component instance) of a list by its saved id, and a page-builder block's property by
 * the block's id. Never by position, so a reordered list leaves every address as it was, and a row
 * that is gone is an address with nothing at it, never another row's text.
 *
 * Two spellings are derived from it. {@link unitKey} is what a suggestion is kept under: one fixed
 * width for an address of any depth, and one key per address. {@link unitProvenancePath} is the
 * path a text's record of where it came from is kept under.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/unit-address
 */

import { createHash } from "node:crypto";

import { TRANSLATION_PROVENANCE_ROW_SEPARATOR } from "../../../schemas/translation-provenance/table-name";
import { isPlainObject } from "../../../shared/lib/plain-copy";

/** One step of an address. */
export type UnitSegment =
  /** A field, of the document, a group, or the row or block before it. */
  | { readonly field: string }
  /** A row of the list before it, or an instance of a repeatable component, by its saved id. */
  | { readonly row: string }
  /** A property of one block of the page-builder field before it, by the block's id. */
  | { readonly node: string; readonly prop: string };

/** The way to one text: a field of the document, then down to it. */
export type UnitAddress = readonly [
  { readonly field: string },
  ...UnitSegment[],
];

/** The address of a top-level field's own text. */
export function fieldUnit(field: string): UnitAddress {
  return [{ field }];
}

/** The name of the document's own field an address starts in. */
export function unitField(address: UnitAddress): string {
  return address[0].field;
}

const isName = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/** One segment as its own keys say it, or `null` for anything that is not exactly one. */
function segmentOf(value: unknown): UnitSegment | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort().join();
  if (keys === "field" && isName(value.field)) return { field: value.field };
  if (keys === "row" && isName(value.row)) return { row: value.row };
  if (keys === "node,prop" && isName(value.node) && isName(value.prop)) {
    return { node: value.node, prop: value.prop };
  }
  return null;
}

/** Whether one segment may stand after the one before it. */
function mayFollow(segment: UnitSegment, before: UnitSegment): boolean {
  // A row is a row of a list, and a block a block of a page: each stands in a
  // field. A block's property is the text itself, so nothing stands after it.
  if ("node" in before) return false;
  return "field" in segment || "field" in before;
}

/**
 * An address as stored or sent, or `null` where `value` is not one: every step one of the three,
 * a field first, a row or a block only inside a field, and a text at the end (a field's or a
 * block's, never a whole row).
 */
export function parseUnitAddress(value: unknown): UnitAddress | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const segments: UnitSegment[] = [];
  for (const each of value) {
    const segment = segmentOf(each);
    const before = segments[segments.length - 1];
    if (segment === null) return null;
    if (
      before === undefined ? !("field" in segment) : !mayFollow(segment, before)
    ) {
      return null;
    }
    segments.push(segment);
  }
  const [first, ...rest] = segments;
  if (first === undefined || !("field" in first)) return null;
  const last = segments[segments.length - 1];
  return last === undefined || "row" in last ? null : [first, ...rest];
}

/** A segment's kind and its parts, for one spelling per segment. */
function framesOf(segment: UnitSegment): string[] {
  if ("field" in segment) return ["field", segment.field];
  if ("row" in segment) return ["row", segment.row];
  return ["node", segment.node, segment.prop];
}

/**
 * The key a unit is kept under: a sha256 of its address in hex. Every part is hashed with its
 * length before it, so no two addresses run together (`a`, `bc` and `ab`, `c`), and by its bytes,
 * so two ids that differ only by case are two keys under any collation.
 */
export function unitKey(address: UnitAddress): string {
  const hash = createHash("sha256");
  for (const part of address.flatMap(framesOf)) {
    const bytes = Buffer.from(part, "utf8");
    // Four bytes, big-endian: a fixed-width frame before a variable payload.
    const frame = Buffer.alloc(4);
    frame.writeUInt32BE(bytes.length);
    hash.update(frame);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/** A row's or block's id as it stands in a path: no character of it reads as the path's own. */
function idInPath(id: string): string {
  return encodeURIComponent(id).replace(/\./g, "%2E");
}

/**
 * The path a text's record of where it came from is kept under. A top-level field's is its name.
 * A text inside one is the field, a separator no field name holds, and the way down to the text:
 * `sections#<row>.caption`, `sections#<row>.points#<row>.text`, `seo#.metaTitle`. So a text's
 * record never reads as a field's, nor a row's own (`sections#<row>`) as a text's.
 */
export function unitProvenancePath(address: UnitAddress): string {
  const [first, ...rest] = address;
  if (rest.length === 0) return first.field;
  const separator = TRANSLATION_PROVENANCE_ROW_SEPARATOR;
  return rest.reduce<string>((path, segment, index) => {
    const opens = index === 0 ? separator : "";
    if ("field" in segment) return `${path}${opens}.${segment.field}`;
    if ("row" in segment) return `${path}${separator}${idInPath(segment.row)}`;
    return `${path}${separator}${idInPath(segment.node)}.${segment.prop}`;
  }, first.field);
}

/**
 * The path a row's own record is kept under, by its field and its id: what says where a row of a
 * list, or a block, came from.
 */
export function rowProvenancePath(field: string, rowId: string): string {
  return `${field}${TRANSLATION_PROVENANCE_ROW_SEPARATOR}${idInPath(rowId)}`;
}

/**
 * Whether a record's path is of a text inside a field, and not of a field or of a row: one with a
 * `.` after its first separator, which no id in a path holds. The one answer, in code as
 * {@link TEXT_PATH_PATTERN} is in a query.
 */
export function isTextPath(path: string): boolean {
  const separator = path.indexOf(TRANSLATION_PROVENANCE_ROW_SEPARATOR);
  return separator !== -1 && path.includes(".", separator);
}

/** {@link isTextPath} as a `LIKE` pattern. */
export const TEXT_PATH_PATTERN = `%${TRANSLATION_PROVENANCE_ROW_SEPARATOR}%.%`;

/**
 * An address after a top-level field was renamed: the same text, under the field's new name.
 * One that starts in another field is as it was.
 */
export function renamedUnit(
  address: UnitAddress,
  from: string,
  to: string
): UnitAddress {
  const [first, ...rest] = address;
  return first.field === from ? [{ field: to }, ...rest] : address;
}

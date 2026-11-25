/**
 * Every translatable text of a document, by its address: what a translation page lists, in the
 * order its fields and rows stand in.
 *
 * What is translatable is read from the shapes a save splits a value by, never from a list of its
 * own, so a text is listed exactly where a language keeps one. A row with no id of its own keeps no
 * language's text, so it has none to list.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/document-texts
 */

import { parsedValue } from "../../../shared/lib/json-column-value";
import { isPlainObject } from "../../../shared/lib/plain-copy";
import {
  isWholeValue,
  rowKeys,
  shapeOfRow,
  splitSharedStructure,
  type SharedStructureShape,
} from "../shared-structure";

import { fieldUnit, type UnitAddress, type UnitSegment } from "./unit-address";

/** What a collection or Single translates, by its own fields. */
export interface TranslatableFields {
  /** Each translatable field, in the order it is declared. */
  readonly names: readonly string[];
  /**
   * The shape of each field among `names` that keeps its text inside (a repeater, a group, a
   * component). A field with none is one text itself.
   */
  readonly shapes: ReadonlyMap<string, SharedStructureShape>;
}

/** The way to one level's texts, before the text's own field. */
type Prefix = readonly [{ readonly field: string }, ...UnitSegment[]];

/** Which texts of a level are listed: every one its shape has, or those it was given with. */
type Listed = "every" | "given";

/**
 * One level's own texts and those inside its containers: one row's, or a group's, which is `null`
 * where nothing was ever written in it.
 */
function textsOfLevel(
  level: Readonly<Record<string, unknown>> | null,
  shape: SharedStructureShape,
  prefix: Prefix,
  listed: Listed
): UnitAddress[] {
  const { texts, inner } = shapeOfRow({ ...level }, shape);
  const given = (field: string) =>
    listed === "every" || level === null || Object.hasOwn(level, field);
  return [
    ...texts.filter(given).map((field): UnitAddress => [...prefix, { field }]),
    ...Object.entries(inner)
      .filter(([field]) => given(field))
      .flatMap(([field, nested]) =>
        textsOfContainer(level?.[field], nested, [...prefix, { field }], listed)
      ),
  ];
}

/** The texts inside a container's value, each row's by its id. */
function textsOfContainer(
  stored: unknown,
  shape: SharedStructureShape,
  prefix: Prefix,
  listed: Listed
): UnitAddress[] {
  const value = parsedValue(stored);
  if (shape.kind === "group") {
    // A group holds its texts whether or not anything was written in it yet.
    if (value === null || value === undefined) {
      return textsOfLevel(null, shape, prefix, listed);
    }
    return isPlainObject(value)
      ? textsOfLevel(value, shape, prefix, listed)
      : [];
  }
  if (!Array.isArray(value)) return [];
  const keys = rowKeys(value);
  return value.flatMap((row: unknown, index) => {
    const id = keys[index];
    return id === undefined || !isPlainObject(row)
      ? []
      : textsOfLevel(row, shape, [...prefix, { row: id }], listed);
  });
}

/**
 * The addresses of `document`'s translatable texts, in order. A field `document` does not hold has
 * none. Inside a container, every text its shape has is listed, held or not: a container's stored
 * structure holds none of them.
 */
export function documentTexts(
  document: Readonly<Record<string, unknown>>,
  fields: TranslatableFields
): UnitAddress[] {
  return listedTexts(document, fields, "every");
}

/**
 * {@link documentTexts} of a document as it was read, with none the caller may not read: a read gives
 * a row, or a group written in, a value for each of its texts, `null` where there is none, so one
 * missing there was left out.
 */
export function readTexts(
  document: Readonly<Record<string, unknown>>,
  fields: TranslatableFields
): UnitAddress[] {
  return listedTexts(document, fields, "given");
}

function listedTexts(
  document: Readonly<Record<string, unknown>>,
  { names, shapes }: TranslatableFields,
  listed: Listed
): UnitAddress[] {
  return names.flatMap(field => {
    if (!Object.hasOwn(document, field)) return [];
    const shape = shapes.get(field);
    return shape === undefined
      ? [fieldUnit(field)]
      : textsOfContainer(document[field], shape, [{ field }], listed);
  });
}

/** One text of a language, by its address. */
type AddressedText = readonly [address: UnitAddress, value: unknown];

/** The texts one level of an overlay holds: a group's, or one row's. */
function textsOfOverlayLevel(
  level: Readonly<Record<string, unknown>>,
  { texts, inner }: SharedStructureShape,
  prefix: Prefix
): AddressedText[] {
  return [
    ...texts
      .filter(field => Object.hasOwn(level, field))
      .map((field): AddressedText => [[...prefix, { field }], level[field]]),
    ...Object.entries(inner).flatMap(([field, nested]) =>
      textsOfOverlay(level[field], nested, [...prefix, { field }])
    ),
  ];
}

/** The texts an overlay holds, each row's by the id it is kept under. */
function textsOfOverlay(
  overlay: unknown,
  shape: SharedStructureShape,
  prefix: Prefix
): AddressedText[] {
  if (!isPlainObject(overlay)) return [];
  if (shape.kind === "group") {
    return textsOfOverlayLevel(overlay, shape, prefix);
  }
  return Object.entries(overlay).flatMap(([row, level]) =>
    isPlainObject(level)
      ? textsOfOverlayLevel(level, shape, [...prefix, { row }])
      : []
  );
}

/**
 * The texts a language's own column holds for a container, with none filled from another: its
 * overlay as it is stored, which names each row by its id and holds no row's type, so a dynamic
 * zone's are read by every type's fields together.
 */
export function overlayTexts(
  field: string,
  stored: unknown,
  shape: SharedStructureShape
): AddressedText[] {
  const value = parsedValue(stored);
  // A container copied over from before it kept its text apart.
  const overlay = isWholeValue(value, shape)
    ? splitSharedStructure(value, shape).overlay
    : value;
  return textsOfOverlay(overlay, shape, [{ field }]);
}

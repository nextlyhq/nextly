/**
 * One structure across languages for repeaters and groups.
 *
 * A repeater or a group of a translated entity is stored in two parts:
 *
 * - the STRUCTURE, on the main table's column: a repeater's rows with their ids and order, and
 *   every shared value inside (a number, a select, a reference, a text marked `localized: false`).
 *   It is the same in every language, so a reorder, an added row or a removed row made in one
 *   language is made in all of them.
 * - one OVERLAY per language, on that language's translation row (the column of the same name in
 *   `<table>_locales`): only the translatable values inside, keyed by row id at every depth
 *   (`{ "<rowId>": { "caption": "…", "points": { "<rowId>": { … } } } }`), a group's keyed by
 *   field name. A row keeps its translations by its id, never by its position, so a reorder never
 *   hands one row's text to another.
 *
 * Which values inside are translatable is the rule top-level fields are classified by
 * (`isFieldLocalized`), applied at every depth; nothing here keeps a list of its own.
 *
 * This module is the pure part: the shape of what is translated inside a container, the split of
 * a written value into structure and overlay, the assembly of a read from the structure and the
 * overlays of a fallback chain, and the pruning of overlay entries whose rows are gone.
 *
 * @module domains/i18n/shared-structure
 */

import { isDeepStrictEqual } from "node:util";

import { parsedValue } from "../../shared/lib/json-column-value";
import { isPlainObject as isPlainRecord } from "../../shared/lib/plain-copy";

import { isBlank } from "./blank-value";
import { isFieldLocalized, neverTranslatable } from "./classify-fields";

/** The field shape this module reads: a container and the fields inside it, at every depth. */
export interface StructuredField {
  name?: string;
  type: string;
  localized?: boolean;
  virtual?: boolean;
  options?: unknown;
  fields?: readonly StructuredField[];
}

/**
 * What one container translates inside: its kind, the names of the translatable values at its
 * level, and the containers at its level that translate values of their own, by name.
 */
export interface SharedStructureShape {
  kind: "repeater" | "group";
  texts: readonly string[];
  inner: Readonly<Record<string, SharedStructureShape>>;
}

/** One level of an overlay: a row's (or a group's) translatable values, nested overlays by name. */
type OverlayLevel = Record<string, unknown>;

/** The container types whose values hold one structure across languages. */
function isStructureContainer(
  field: StructuredField
): field is StructuredField & { type: "repeater" | "group" } {
  return field.type === "repeater" || field.type === "group";
}

/**
 * The shape of what `field` translates inside, or `null` where it translates nothing there: a
 * field that is no repeater or group, one translated whole (`localized: true`, whose value is kept
 * per language as it stands), one that is never translatable, or one holding no translatable
 * value at any depth. Read for a field of a translated entity.
 */
export function sharedStructureShape(
  field: StructuredField
): SharedStructureShape | null {
  if (!isStructureContainer(field)) return null;
  if (field.localized === true || neverTranslatable(field)) return null;
  return shapeOfLevel(field.type, field.fields ?? [], new WeakSet());
}

/**
 * Whether `field` keeps translations inside it, and so has an overlay column on its entity's
 * translation table beside its structure on the main table. False on an entity that is not
 * translated.
 */
export function keepsTranslationsInside(
  field: StructuredField,
  entityLocalized: boolean
): boolean {
  return entityLocalized && sharedStructureShape(field) !== null;
}

/**
 * Whether `field` has a column on its entity's translation table: a field translated as a whole
 * (`isFieldLocalized`), whose column there replaces the main table's, or a container keeping
 * translations inside (`keepsTranslationsInside`), whose overlay column there sits beside its
 * structure on the main table.
 */
export function hasTranslationColumn(
  field: StructuredField & { name: string },
  entityLocalized: boolean
): boolean {
  return (
    isFieldLocalized(field, entityLocalized) ||
    keepsTranslationsInside(field, entityLocalized)
  );
}

/** {@link sharedStructureShape} for one level's fields. `open` stops a layout that reaches itself. */
function shapeOfLevel(
  kind: "repeater" | "group",
  fields: readonly StructuredField[],
  open: WeakSet<object>
): SharedStructureShape | null {
  const texts: string[] = [];
  const inner: Record<string, SharedStructureShape> = {};
  const visit = (level: readonly StructuredField[]) => {
    for (const child of level) {
      if (!child.name) {
        // A group with no name only lays fields out: they are values of this level.
        if (child.type === "group" && child.fields && !open.has(child)) {
          open.add(child);
          visit(child.fields);
          open.delete(child);
        }
        continue;
      }
      if (isStructureContainer(child)) {
        // A container inside keeps the one structure too, whatever its own flag says: no level
        // of a shared structure has rows of its own per language.
        if (open.has(child) || neverTranslatable(child)) continue;
        open.add(child);
        const nested = shapeOfLevel(child.type, child.fields ?? [], open);
        open.delete(child);
        if (nested) inner[child.name] = nested;
        continue;
      }
      // The rule a top-level field of a translated entity is classified by.
      if (isFieldLocalized({ ...child, name: child.name }, true)) {
        texts.push(child.name);
      }
    }
  };
  visit(fields);
  if (texts.length === 0 && Object.keys(inner).length === 0) return null;
  return { kind, texts, inner };
}

/** A repeater row's id, where it has one: a non-empty string. */
function idOf(row: unknown): string | undefined {
  return isPlainRecord(row) && typeof row.id === "string" && row.id !== ""
    ? row.id
    : undefined;
}

/** A value as stored or sent: JSON text read, anything else as it is. */
function valueOf(value: unknown): unknown {
  return parsedValue(value);
}

/**
 * Split a written container value into its structure and one language's overlay. The structure
 * holds every row with its id and order and every shared value; the overlay holds the
 * translatable values, keyed by row id (a group's by field name). A row with no id keeps its
 * translatable values on the structure, so nothing written is lost: rows are given ids before a
 * write is split, and such a row only reaches here from a writer that skipped that step.
 *
 * `overlay` is `undefined` for a value that is not one this shape can split (null, or the wrong
 * kind), which the caller writes as given.
 */
export function splitSharedStructure(
  value: unknown,
  shape: SharedStructureShape
): { structure: unknown; overlay: OverlayLevel | undefined } {
  const parsed = valueOf(value);
  if (shape.kind === "group") {
    if (!isPlainRecord(parsed)) return { structure: value, overlay: undefined };
    const { structure, overlay } = splitLevel(parsed, shape);
    return { structure, overlay };
  }
  if (!Array.isArray(parsed)) return { structure: value, overlay: undefined };
  const overlay: OverlayLevel = {};
  const structure = parsed.map(row => {
    if (!isPlainRecord(row)) return row;
    const id = idOf(row);
    if (id === undefined) return row;
    const split = splitLevel(row, shape);
    if (Object.keys(split.overlay).length > 0) overlay[id] = split.overlay;
    return split.structure;
  });
  return { structure, overlay };
}

/** One row's (or one group's) split: its shared values, and its translatable values by name. */
function splitLevel(
  level: Record<string, unknown>,
  shape: SharedStructureShape
): { structure: Record<string, unknown>; overlay: OverlayLevel } {
  const structure: Record<string, unknown> = { ...level };
  const overlay: OverlayLevel = {};
  for (const name of shape.texts) {
    if (!Object.hasOwn(structure, name)) continue;
    overlay[name] = structure[name];
    delete structure[name];
  }
  for (const [name, nestedShape] of Object.entries(shape.inner)) {
    if (!Object.hasOwn(structure, name)) continue;
    const nested = splitSharedStructure(structure[name], nestedShape);
    structure[name] = nested.structure;
    if (nested.overlay && Object.keys(nested.overlay).length > 0) {
      overlay[name] = nested.overlay;
    }
  }
  return { structure, overlay };
}

/**
 * A container's value in one language: its structure, with each translatable value filled from
 * the first overlay of `overlays` (a fallback chain's, in its order) holding a value that is not
 * blank for that row and field. Each field falls back on its own. A value no language holds reads
 * as the structure itself holds it, which is how a value stored before the container kept its
 * translations apart still reads, or `null`. Overlay entries of rows the structure does not hold
 * are never read. Overlays and structure may be JSON text.
 */
export function assembleSharedStructure(
  structure: unknown,
  overlays: readonly unknown[],
  shape: SharedStructureShape
): unknown {
  const parsed = valueOf(structure);
  const levels = overlays.map(valueOf).map(o => (isPlainRecord(o) ? o : {}));
  if (shape.kind === "group") {
    return isPlainRecord(parsed)
      ? assembleLevel(parsed, levels, shape)
      : structure;
  }
  if (!Array.isArray(parsed)) return structure;
  return parsed.map(row => {
    if (!isPlainRecord(row)) return row;
    const id = idOf(row);
    const rowLevels = levels.map(level => {
      if (id === undefined || !Object.hasOwn(level, id)) return {};
      const entry = level[id];
      return isPlainRecord(entry) ? entry : {};
    });
    return assembleLevel(row, rowLevels, shape);
  });
}

/** One row (or one group) filled from its overlay entries, in fallback order. */
function assembleLevel(
  level: Record<string, unknown>,
  overlays: readonly OverlayLevel[],
  shape: SharedStructureShape
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...level };
  for (const name of shape.texts) {
    const found = overlays.find(
      overlay => Object.hasOwn(overlay, name) && !isBlank(overlay[name])
    );
    out[name] = found
      ? found[name]
      : Object.hasOwn(level, name) && !isBlank(level[name])
        ? level[name]
        : null;
  }
  for (const [name, nestedShape] of Object.entries(shape.inner)) {
    if (!Object.hasOwn(level, name)) continue;
    out[name] = assembleSharedStructure(
      level[name],
      overlays.map(overlay =>
        Object.hasOwn(overlay, name) ? overlay[name] : undefined
      ),
      nestedShape
    );
  }
  return out;
}

/**
 * `overlay` without the entries of rows `structure` no longer holds, at every depth, and whether
 * anything was dropped. Run on every language's overlay when a write changes the structure, so a
 * removed row's translations go with it rather than waiting for a row given its id again.
 */
export function pruneOverlay(
  overlay: unknown,
  structure: unknown,
  shape: SharedStructureShape
): { overlay: OverlayLevel; changed: boolean } {
  const parsed = valueOf(overlay);
  const level = isPlainRecord(parsed) ? parsed : {};
  const kept = valueOf(structure);
  if (shape.kind === "group") {
    return pruneLevel(level, isPlainRecord(kept) ? kept : {}, shape);
  }
  const rows = new Map<string, Record<string, unknown>>();
  if (Array.isArray(kept)) {
    for (const row of kept) {
      const id = idOf(row);
      if (id !== undefined && isPlainRecord(row)) rows.set(id, row);
    }
  }
  const out: OverlayLevel = {};
  let changed = false;
  for (const [id, entry] of Object.entries(level)) {
    const row = rows.get(id);
    if (!row || !isPlainRecord(entry)) {
      changed = true;
      continue;
    }
    const pruned = pruneLevel(entry, row, shape);
    out[id] = pruned.overlay;
    changed ||= pruned.changed;
  }
  return { overlay: out, changed };
}

/** One row's (or one group's) overlay entry pruned against its structure's nested containers. */
function pruneLevel(
  entry: OverlayLevel,
  structure: Record<string, unknown>,
  shape: SharedStructureShape
): { overlay: OverlayLevel; changed: boolean } {
  const out: OverlayLevel = { ...entry };
  let changed = false;
  for (const [name, nestedShape] of Object.entries(shape.inner)) {
    if (!Object.hasOwn(out, name)) continue;
    const nested = pruneOverlay(out[name], structure[name], nestedShape);
    out[name] = nested.overlay;
    changed ||= nested.changed;
  }
  return { overlay: out, changed };
}

/**
 * Whether `value`, held for one language, is the container's whole value rather than the text
 * alone: a repeater's rows (its text is keyed by row id, never a list), or a group holding a value
 * that is not text. A group holding text alone reads the same either way, and is the text.
 */
export function isWholeValue(
  value: unknown,
  shape: SharedStructureShape
): boolean {
  const parsed = valueOf(value);
  if (shape.kind === "repeater") return Array.isArray(parsed);
  if (!isPlainRecord(parsed)) return false;
  const text = new Set([...shape.texts, ...Object.keys(shape.inner)]);
  return Object.keys(parsed).some(key => !text.has(key));
}

/** Whether `value`, a container's value, holds any translatable text at any depth. */
export function holdsText(
  value: unknown,
  shape: SharedStructureShape
): boolean {
  const { overlay } = splitSharedStructure(value, shape);
  return overlay !== undefined && !sameShare(overlay, {});
}

/**
 * Whether two shares of a container (two structures, or two overlays) hold the same: JSON text
 * read (the stored value alone; the text values inside are values, never JSON), and a blank value
 * read as an absent one at every depth, since both read as nothing there (or nothing translated).
 * The one comparison a held share is judged changed by and an upgrade judges languages alike by.
 */
export function sameShare(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(
    withoutBlanks(valueOf(a)),
    withoutBlanks(valueOf(b))
  );
}

/**
 * `value` with every blank value left out, at every depth, and an object left with nothing in it
 * left out too: a row's text entry holding only blanks reads as no entry, as a split leaves none.
 */
function withoutBlanks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutBlanks);
  if (!isPlainRecord(value)) return isBlank(value) ? undefined : value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const kept = withoutBlanks(inner);
    if (kept !== undefined) out[key] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `value` in the representation `like` came in: JSON text where `like` was text. */
function asStoredLike(like: unknown, value: unknown): unknown {
  return typeof like === "string" && value !== null && value !== undefined
    ? JSON.stringify(value)
    : value;
}

/**
 * {@link splitSharedStructure} for a value on its way to storage: the structure and the overlay
 * come back as JSON text where the value was text, as an earlier step of the write encoded it. A
 * value that is not one this shape splits (null, cleared) is the structure as given, and clears
 * the language's overlay.
 */
export function splitStoredValue(
  value: unknown,
  shape: SharedStructureShape
): { structure: unknown; overlay: unknown } {
  const { structure, overlay } = splitSharedStructure(value, shape);
  if (overlay === undefined) return { structure: value, overlay: null };
  return {
    structure: asStoredLike(value, structure),
    overlay: asStoredLike(value, overlay),
  };
}

/**
 * {@link assembleSharedStructure} for a value read from storage: the assembled value comes back
 * as JSON text where the structure was text, as the rest of the read expects a stored value.
 */
export function assembleStoredValue(
  structure: unknown,
  overlays: readonly unknown[],
  shape: SharedStructureShape
): unknown {
  const assembled = assembleSharedStructure(structure, overlays, shape);
  // A structure this shape cannot read comes back as it is, and stays as it was stored.
  return assembled === structure
    ? structure
    : asStoredLike(structure, assembled);
}

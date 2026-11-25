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
import { componentRowContentEntries } from "../field-groups/storage/component-row-content";
import { extractFieldGroupReferences } from "../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../field-groups/storage/field-group-type-key";

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
  /**
   * A dynamic zone's: each component type's own shape, by its slug, read for an instance by the
   * type it records. `texts` and `inner` are every type's together, for an instance with none.
   */
  byType?: Readonly<Record<string, SharedStructureShape>>;
}

/** A component's own fields, by its slug, as the document's components resolve them. */
export type ComponentFieldsOf = (
  slug: string
) => readonly StructuredField[] | undefined;

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
 * field that is no repeater or group, one carrying its own flag (translated whole, `localized:
 * true`, or shared whole, `localized: false`), one that is never translatable, or one holding no
 * translatable value at any depth. Read for a field of a translated entity.
 *
 * A component placed inside (its values held inline in the container's rows) is read through its
 * own fields with `components`; without, it is no value of the container's, as where its fields
 * are not to hand (`placesComponent` says whether the shape needs them).
 */
export function sharedStructureShape(
  field: StructuredField,
  components?: ComponentFieldsOf
): SharedStructureShape | null {
  if (!isStructureContainer(field)) return null;
  // A container saying it is not translated (`localized: false`) is shared whole, as a top-level
  // field saying so is; `localized: true` on one is refused at load.
  if (field.localized !== undefined || neverTranslatable(field)) return null;
  return shapeOfLevel(
    field.type,
    field.fields ?? [],
    new WeakSet(),
    components ? { fieldsOf: components, open: new Set() } : undefined
  );
}

/**
 * Whether a repeater or group places a component anywhere inside it, whose values its rows hold
 * inline: its shape then depends on that component's fields, read from the registry when its
 * values are split or put back together. Answered from the container's own definition alone.
 */
export function placesComponent(field: StructuredField): boolean {
  if (!isStructureContainer(field)) return false;
  const open = new WeakSet<object>();
  const visit = (level: readonly StructuredField[]): boolean =>
    level.some(child => {
      if (componentSlugsOf(child).length > 0) return true;
      if (!isStructureContainer(child) || open.has(child)) return false;
      open.add(child);
      return visit(child.fields ?? []);
    });
  return visit(field.fields ?? []);
}

/**
 * Whether `field` keeps translations inside it, and so has an overlay column on its entity's
 * translation table beside its structure on the main table: one holding translatable text, or
 * placing a component (whose text, if any, is known only from its own fields). Decided from the
 * entity's own definition, so its tables never depend on another entity's. False on an entity
 * that is not translated, and for a container carrying its own flag.
 */
export function keepsTranslationsInside(
  field: StructuredField,
  entityLocalized: boolean
): boolean {
  if (!entityLocalized) return false;
  if (field.localized !== undefined || neverTranslatable(field)) return false;
  return sharedStructureShape(field) !== null || placesComponent(field);
}

/**
 * The shape a container keeping translations inside is split by before its components' fields
 * are read: what it translates of its own, or nothing yet. Read again with the components' fields
 * once they are to hand (`sharedStructureShape`), a component holding no text leaves it empty.
 */
export function shapeBeforeComponents(
  field: StructuredField & { type: string }
): SharedStructureShape {
  return (
    sharedStructureShape(field) ?? {
      kind: field.type === "group" ? "group" : "repeater",
      texts: [],
      inner: {},
    }
  );
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

/** What {@link shapeOfLevel} reaches components through, and the components already open. */
interface ComponentReach {
  fieldsOf: ComponentFieldsOf;
  open: ReadonlySet<string>;
}

/**
 * {@link sharedStructureShape} for one level's fields. `open` stops a layout that reaches itself.
 * With `components`, a component placed at the level is read through its own fields
 * ({@link componentStructureShape}); without, it is no value of the level's.
 */
function shapeOfLevel(
  kind: "repeater" | "group",
  fields: readonly StructuredField[],
  open: WeakSet<object>,
  components?: ComponentReach
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
      const added = childShape(child, child.name, open, components);
      if (added === "text") texts.push(child.name);
      else if (added !== null) inner[child.name] = added;
    }
  };
  visit(fields);
  if (texts.length === 0 && Object.keys(inner).length === 0) return null;
  return { kind, texts, inner };
}

/**
 * What one named field of a level adds to the level's shape: the shape of what it translates
 * inside (a component it places, or a container inside), `"text"` where it is translatable text
 * of the level itself, or `null` where it translates nothing.
 */
function childShape(
  child: StructuredField,
  name: string,
  open: WeakSet<object>,
  components: ComponentReach | undefined
): SharedStructureShape | "text" | null {
  // A field inside saying it is not translated, a container or a component among them, holds no
  // text of any language's: shared whole with the rest of the structure.
  if (child.localized === false) return null;
  if (components && componentSlugsOf(child).length > 0) {
    return componentStructureShape(child, components.fieldsOf, components.open);
  }
  if (isStructureContainer(child)) {
    // A container inside keeps the one structure too, whatever its own flag says: no level of a
    // shared structure has rows of its own per language.
    if (open.has(child) || neverTranslatable(child)) return null;
    open.add(child);
    const nested = shapeOfLevel(
      child.type,
      child.fields ?? [],
      open,
      components
    );
    open.delete(child);
    return nested;
  }
  // The rule a top-level field of a translated entity is classified by.
  return isFieldLocalized({ ...child, name }, true) ? "text" : null;
}

/** The components a field places: one, or a dynamic zone's several; none for any other field. */
function componentSlugsOf(field: StructuredField): string[] {
  const { single, many } = extractFieldGroupReferences(field);
  return many ?? (single === undefined ? [] : [single]);
}

/**
 * The shape of what a component field translates inside, or `null` where it translates nothing:
 * its instances (one, or a list for a repeatable one, each with its id)
 * keep one structure across languages, as a group's or a repeater's rows do, and the text inside
 * is each language's. Read through each component's own fields (`fieldsOf`), every component it
 * places in turn; a component that reaches itself stops there.
 */
export function componentStructureShape(
  field: StructuredField,
  fieldsOf: ComponentFieldsOf,
  open: ReadonlySet<string> = new Set()
): SharedStructureShape | null {
  const slugs = componentSlugsOf(field);
  if (slugs.length === 0) return null;
  // A list of instances only where the field is repeatable: one offering several component types
  // (`components`) holds one instance otherwise, stored as an object.
  const kind =
    (field as { repeatable?: unknown }).repeatable === true
      ? "repeater"
      : "group";
  const byType: Record<string, SharedStructureShape> = {};
  for (const slug of slugs) {
    const fields = open.has(slug) ? undefined : fieldsOf(slug);
    if (!fields) continue;
    const shape = shapeOfLevel(kind, fields, new WeakSet(), {
      fieldsOf,
      open: new Set([...open, slug]),
    });
    if (shape) byType[slug] = shape;
  }
  const shapes = Object.values(byType);
  if (shapes.length === 0) return null;
  const texts = [...new Set(shapes.flatMap(shape => shape.texts))];
  const inner: Record<string, SharedStructureShape> = {};
  for (const shape of shapes) {
    for (const [name, nested] of Object.entries(shape.inner)) {
      inner[name] ??= nested;
    }
  }
  return {
    kind,
    texts,
    inner,
    ...(slugs.length > 1 ? { byType } : {}),
  };
}

/** The shape a row (or an instance) is read by: its component type's, in a dynamic zone. */
function shapeOfRow(
  row: Record<string, unknown>,
  shape: SharedStructureShape
): SharedStructureShape {
  if (!shape.byType) return shape;
  const type = readFieldGroupType(row);
  return (type !== undefined && shape.byType[type]) || shape;
}

/**
 * The key each row of a list keeps its translations under: its id, a non-empty string as the
 * system gives every row, or a finite number a repeater declaring its own `id` field may hold, by
 * its text. A row with no such id, or whose id an earlier row of the list already holds, has none,
 * and keeps its translatable values on the structure: two rows never share one overlay entry.
 */
function rowKeys(rows: readonly unknown[]): (string | undefined)[] {
  const taken = new Set<string>();
  return rows.map(row => {
    const key = keyOf(row);
    if (key === undefined || taken.has(key)) return undefined;
    taken.add(key);
    return key;
  });
}

/** A row's id as an overlay key, before {@link rowKeys} judges it against the other rows. */
function keyOf(row: unknown): string | undefined {
  if (!isPlainRecord(row)) return undefined;
  const { id } = row;
  if (typeof id === "string") return id === "" ? undefined : id;
  return typeof id === "number" && Number.isFinite(id) ? String(id) : undefined;
}

/**
 * One language's overlay as the text alone: a value held whole (`isWholeValue`), as a container's
 * value is when it is copied over to the default language from before the container kept its
 * text apart, is read as its split's overlay, so every reader reads it the same as a written one.
 */
function overlayOf(value: unknown, shape: SharedStructureShape): unknown {
  const parsed = valueOf(value);
  return isWholeValue(parsed, shape)
    ? (splitSharedStructure(parsed, shape).overlay ?? {})
    : parsed;
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
    // A single component instance offering several types is read by its own type's shape.
    const { structure, overlay } = splitLevel(
      parsed,
      shapeOfRow(parsed, shape)
    );
    return { structure, overlay };
  }
  if (!Array.isArray(parsed)) return { structure: value, overlay: undefined };
  const overlay: OverlayLevel = {};
  const keys = rowKeys(parsed);
  const structure = parsed.map((row, index) => {
    if (!isPlainRecord(row)) return row;
    const id = keys[index];
    if (id === undefined) return row;
    const split = splitLevel(row, shapeOfRow(row, shape));
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
  const levels = overlays
    .map(overlay => overlayOf(overlay, shape))
    .map(o => (isPlainRecord(o) ? o : {}));
  if (shape.kind === "group") {
    return isPlainRecord(parsed)
      ? assembleLevel(parsed, levels, shapeOfRow(parsed, shape))
      : structure;
  }
  if (!Array.isArray(parsed)) return structure;
  const keys = rowKeys(parsed);
  return parsed.map((row, index) => {
    if (!isPlainRecord(row)) return row;
    const id = keys[index];
    const rowLevels = levels.map(level => {
      if (id === undefined || !Object.hasOwn(level, id)) return {};
      const entry = level[id];
      return isPlainRecord(entry) ? entry : {};
    });
    return assembleLevel(row, rowLevels, shapeOfRow(row, shape));
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
 * One language's overlay `primary` over `fallback`, an older overlay of the same language: each
 * text `primary` holds wins, a blank one included, since a held draft that clears a text means it;
 * each text it does not hold is `fallback`'s. Rows by their key and nested containers in turn,
 * read by `shape`, so a text value that is itself an object (a rich text document) is one value,
 * never merged with another.
 */
export function overlayOver(
  primary: unknown,
  fallback: unknown,
  shape: SharedStructureShape
): OverlayLevel {
  const over = asLevel(overlayOf(primary, shape));
  const under = asLevel(overlayOf(fallback, shape));
  if (shape.kind === "repeater") {
    const out: OverlayLevel = { ...under };
    for (const [key, entry] of Object.entries(over)) {
      out[key] = levelOver(asLevel(entry), asLevel(under[key]), shape);
    }
    return out;
  }
  return levelOver(over, under, shape);
}

/** {@link overlayOver} for one row's (or one group's) entry. */
function levelOver(
  over: OverlayLevel,
  under: OverlayLevel,
  shape: SharedStructureShape
): OverlayLevel {
  const out: OverlayLevel = { ...under };
  for (const name of shape.texts) {
    if (Object.hasOwn(over, name)) out[name] = over[name];
  }
  for (const [name, nested] of Object.entries(shape.inner)) {
    if (Object.hasOwn(over, name)) {
      out[name] = overlayOver(over[name], under[name], nested);
    }
  }
  return out;
}

/** A value as an overlay level: a plain record, or an empty one. */
function asLevel(value: unknown): OverlayLevel {
  return isPlainRecord(value) ? value : {};
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
    const structureKept = isPlainRecord(kept) ? kept : {};
    return pruneLevel(level, structureKept, shapeOfRow(structureKept, shape));
  }
  const rows = new Map<string, Record<string, unknown>>();
  if (Array.isArray(kept)) {
    const keys = rowKeys(kept);
    kept.forEach((row, index) => {
      const id = keys[index];
      if (id !== undefined && isPlainRecord(row)) rows.set(id, row);
    });
  }
  const out: OverlayLevel = {};
  let changed = false;
  for (const [id, entry] of Object.entries(level)) {
    const row = rows.get(id);
    if (!row || !isPlainRecord(entry)) {
      changed = true;
      continue;
    }
    const pruned = pruneLevel(entry, row, shapeOfRow(row, shape));
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

/**
 * Whether `value`, a container's value, holds translatable text on a row or component instance
 * that has no key of its own (no id, or one an earlier row of its list holds), at any depth: text
 * a split cannot file by row, so it stays on the structure ({@link splitSharedStructure}), where
 * it would be read as every language's.
 */
export function holdsUnkeyedText(
  value: unknown,
  shape: SharedStructureShape
): boolean {
  const parsed = valueOf(value);
  if (shape.kind === "group") {
    return (
      isPlainRecord(parsed) &&
      innerHoldsUnkeyedText(parsed, shapeOfRow(parsed, shape))
    );
  }
  if (!Array.isArray(parsed)) return false;
  const keys = rowKeys(parsed);
  return parsed.some((row, index) => {
    if (!isPlainRecord(row)) return false;
    const rowShape = shapeOfRow(row, shape);
    // A row with no key: any text of its own, or text in a list inside it.
    if (keys[index] === undefined) {
      const { overlay } = splitLevel(row, rowShape);
      if (!sameShare(overlay, {})) return true;
    }
    return innerHoldsUnkeyedText(row, rowShape);
  });
}

/** Whether a container nested in `level` holds text on a row with no key. */
function innerHoldsUnkeyedText(
  level: Record<string, unknown>,
  shape: SharedStructureShape
): boolean {
  return Object.entries(shape.inner).some(
    ([name, nested]) =>
      Object.hasOwn(level, name) && holdsUnkeyedText(level[name], nested)
  );
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
  // A component instance's own row timestamps are no content of it (`component-row-content`).
  for (const [key, inner] of componentRowContentEntries(value)) {
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

/**
 * Whether a structure a save writes is the one the row stores, read as values (`parsedValue`):
 * stored as JSON text on one driver and as an object on another, the two compare by what they
 * hold. A save writing back the same structure changes nothing the row's version covers.
 */
export function sameSharedStructure(
  written: unknown,
  stored: unknown
): boolean {
  if (stored === undefined) return false;
  return isDeepStrictEqual(parsedValue(written), parsedValue(stored));
}

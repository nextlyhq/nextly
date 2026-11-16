/**
 * Moving a field between containers: where its values are stored before and after, and whether a
 * move keeps them. A move into or out of a group keeps each entry's value, carried from a column
 * to a key in the group's JSON or back; every move a group cannot hold is refused before anything
 * changes, with the reason it gives the person:
 *
 * - a field the database keeps unique into a group, whose JSON value cannot be kept unique;
 * - a move into repeating rows (not available yet) or out of them (an entry's many rows cannot
 *   become one value);
 * - a move into or out of a field group, which is changed only in its own editor, or a blocks
 *   field, which holds blocks declared in code;
 * - a move that would change whether the field keeps a value for each language, which a group
 *   kept the same for every language cannot hold;
 * - a move made in the same save as a change of the field's type;
 * - a field with no column of its own (a virtual field, a field group, a many-to-many
 *   relationship), whose values are not on the entry's row to move.
 *
 * A field is named by its path: the names of the named containers above it, outermost first, then
 * its own. A group with no name is not on the path, since its fields are stored beside it.
 *
 * @module domains/schema/field-moves/check-move
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { addressableFields } from "../../../shared/addressable-fields";
import { isFieldGroupFieldType } from "../../field-groups/storage/field-group-field-type";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { builderColumnIsUnique, toSnakeCase } from "../field-rules";
import {
  classifyFieldKind,
  fieldProducesColumn,
  isTextStorageKind,
} from "../services/field-column-descriptor";

/** Where a field's values are: a column of their own, or a key inside a container's JSON column. */
export type StoragePlace =
  | { kind: "column"; column: string }
  | { kind: "json"; column: string; keys: readonly string[] };

/** A field at a path: the field, the named containers above it, and where its values are. */
export interface PlacedField {
  field: FieldDefinition;
  containers: readonly FieldDefinition[];
  place: StoragePlace;
}

/** A move as asked: the field's path before, and its path after. */
export interface FieldMoveRequest {
  from: readonly string[];
  to: readonly string[];
}

/** A move that keeps every value: the field as it is after, and the two places. */
export interface PlannedMove {
  field: FieldDefinition;
  from: StoragePlace;
  to: StoragePlace;
  /** The values are kept for each language, so they move in the language table, each row's own. */
  perLanguage: boolean;
}

export type MoveRefusalReason =
  | "not-found"
  | "type-changed"
  | "no-column"
  | "unique"
  | "into-repeater"
  | "within-repeater"
  | "out-of-repeater"
  | "field-group"
  | "blocks"
  | "translation-changes";

export type MoveCheck =
  | { ok: true; move: PlannedMove }
  | { ok: false; reason: MoveRefusalReason; message: string };

/** What the entity says of translation, which decides where a translated field's values are. */
export interface MoveEntity {
  localized?: boolean;
}

function nameOf(field: FieldDefinition): string | undefined {
  const { name } = field as { name?: unknown };
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function childrenOf(field: FieldDefinition): readonly FieldDefinition[] {
  const { fields } = field as { fields?: unknown };
  return Array.isArray(fields) ? (fields as FieldDefinition[]) : [];
}

/**
 * The field at `path` in `fields`, with the named containers above it and where its values are
 * stored, or null when no field is there. A group with no name is looked through.
 */
export function placeOf(
  fields: readonly FieldDefinition[],
  path: readonly string[]
): PlacedField | null {
  let level = fields;
  const containers: FieldDefinition[] = [];
  for (const [at, segment] of path.entries()) {
    const found = (addressableFields(level) as unknown as FieldDefinition[]).find(
      field => nameOf(field) === segment
    );
    if (!found) return null;
    if (at === path.length - 1) {
      const [outermost, ...inner] = [...containers, found];
      const column = toSnakeCase(nameOf(outermost) ?? segment);
      const place: StoragePlace =
        containers.length === 0
          ? { kind: "column", column }
          : { kind: "json", column, keys: [...inner].map(each => nameOf(each) ?? "") };
      return { field: found, containers, place };
    }
    containers.push(found);
    level = childrenOf(found);
  }
  return null;
}

/** Whether a field's values are kept for each language where it stands. */
function keptPerLanguage(placed: PlacedField, entity: MoveEntity): boolean {
  const localized = entity.localized === true;
  // Inside a container, the outermost one's storage decides: its whole JSON is kept for each
  // language, or once for every language; a field inside it has no storage of its own.
  const holder = placed.containers[0] ?? placed.field;
  return isFieldLocalized(holder, localized);
}

function label(field: FieldDefinition): string {
  const { label: given } = field as { label?: unknown };
  return typeof given === "string" && given.length > 0
    ? given
    : (nameOf(field) ?? "This field");
}

function refuse(reason: MoveRefusalReason, message: string): MoveCheck {
  return { ok: false, reason, message };
}

/** The refusal of crossing a container a field's values cannot move into or out of, if any. */
function crossingRefusal(
  field: FieldDefinition,
  left: readonly FieldDefinition[],
  entered: readonly FieldDefinition[]
): MoveCheck | null {
  const kinds = (list: readonly FieldDefinition[], type: string) =>
    list.find(each => each.type === type);
  const fieldGroup = [...left, ...entered].find(each =>
    isFieldGroupFieldType(each.type)
  );
  if (fieldGroup) {
    return refuse(
      "field-group",
      `${label(field)} cannot be moved into or out of the field group ${label(fieldGroup)}: a field group is changed only in its own editor.`
    );
  }
  const blocks = kinds(left, "blocks") ?? kinds(entered, "blocks");
  if (blocks) {
    return refuse(
      "blocks",
      `${label(field)} cannot be moved into or out of ${label(blocks)}: a blocks field holds blocks declared in code, not fields.`
    );
  }
  const rowsLeft = kinds(left, "repeater");
  if (rowsLeft) {
    return refuse(
      "out-of-repeater",
      `${label(field)} cannot be moved out of the repeating rows ${label(rowsLeft)}: each entry may hold several rows of it, which one field cannot keep. Add a new field instead.`
    );
  }
  const rowsEntered = kinds(entered, "repeater");
  if (rowsEntered) {
    return refuse(
      "into-repeater",
      `Moving ${label(field)} into the repeating rows ${label(rowsEntered)} is not available yet.`
    );
  }
  return null;
}

/**
 * Whether moving the field at `request.from` in `before` to `request.to` in `after` keeps its
 * values, and how: the planned move, or the refusal with its message.
 */
export function checkMove(
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[],
  request: FieldMoveRequest,
  entity: MoveEntity = {}
): MoveCheck {
  const from = placeOf(before, request.from);
  const to = placeOf(after, request.to);
  if (!from || !to) {
    return refuse(
      "not-found",
      `The move names a field that is not at ${(from ? request.to : request.from).join(".")}.`
    );
  }
  const refusal =
    storageRefusal(from, to) ??
    placesRefusal(from, to) ??
    valuesRefusal(from, to, entity);
  if (refusal) return refusal;
  return {
    ok: true,
    move: {
      field: to.field,
      from: from.place,
      to: to.place,
      perLanguage: keptPerLanguage(from, entity),
    },
  };
}

/** The refusal of a field whose storage changes with the move, or that has no column to move. */
function storageRefusal(from: PlacedField, to: PlacedField): MoveCheck | null {
  if (
    from.field.type !== to.field.type ||
    !sameStorage(from.field, to.field)
  ) {
    return refuse(
      "type-changed",
      `${label(to.field)} is moved and changes type, or how its values are stored, in the same save. Move it and make that change in separate saves.`
    );
  }
  if (!fieldProducesColumn(from.field) || !fieldProducesColumn(to.field)) {
    return refuse(
      "no-column",
      `${label(to.field)} keeps its values outside the entry's row, so it is not moved into or out of a group.`
    );
  }
  return null;
}

/** The refusal of a move between places its values cannot be carried between. */
function placesRefusal(from: PlacedField, to: PlacedField): MoveCheck | null {
  const shared = sharedDepth(from.containers, to.containers);
  // A move that stays inside repeating rows would have to move the value in every row of the
  // list its column holds, which these statements do not do yet.
  const rowsAround = from.containers
    .slice(0, shared)
    .find(each => each.type === "repeater");
  if (rowsAround) {
    return refuse(
      "within-repeater",
      `Moving ${label(to.field)} within the repeating rows ${label(rowsAround)} is not available yet.`
    );
  }
  // Only the containers the move leaves or enters are judged here, not those it stays inside.
  const crossing = crossingRefusal(
    to.field,
    from.containers.slice(shared),
    to.containers.slice(shared)
  );
  if (crossing) return crossing;
  // A container that stores nothing (a virtual group, or one a field group holds), anywhere on
  // either path, has no column or key for its fields' values to be in.
  const emptyHolder = [...from.containers, ...to.containers].find(
    holder => !fieldProducesColumn(holder)
  );
  return emptyHolder
    ? refuse(
        "no-column",
        `${label(to.field)} cannot be moved into or out of ${label(emptyHolder)}: it stores no values of its own.`
      )
    : null;
}

/** The refusal of a move whose destination cannot keep what the field's values are. */
function valuesRefusal(
  from: PlacedField,
  to: PlacedField,
  entity: MoveEntity
): MoveCheck | null {
  // Unique before the move or after it: a move that also drops the uniqueness is two changes, and
  // the uniqueness is changed in a save of its own first.
  if (
    to.place.kind === "json" &&
    (builderColumnIsUnique(from.field) || builderColumnIsUnique(to.field))
  ) {
    return refuse(
      "unique",
      `${label(to.field)} cannot be moved into the group ${label(to.containers[0])}: a group keeps its values in one JSON value, which cannot be kept unique. It can be moved once it is no longer unique (a one-to-one changed to many-to-one, or its unique setting removed), as a change of its own.`
    );
  }
  const perLanguage = keptPerLanguage(from, entity);
  if (perLanguage === keptPerLanguage(to, entity)) return null;
  return refuse(
    "translation-changes",
    perLanguage
      ? `${label(to.field)} keeps a value for each language, and the group it would move into keeps one value for every language, so moving it would lose languages. This is not available yet.`
      : `${label(to.field)} keeps one value for every language, and where it would move keeps a value for each language. This is not available yet.`
  );
}

/**
 * Whether a field stores its values the same way before and after: the canonical column kind,
 * with every text width counted as text (inside JSON a string has no width). A field that keeps
 * its type but changes how it is stored (a number becoming a list of numbers) is not one move.
 */
function sameStorage(before: FieldDefinition, after: FieldDefinition): boolean {
  const a = classifyFieldKind(before, "collection");
  const b = classifyFieldKind(after, "collection");
  return a === b || (isTextStorageKind(a) && isTextStorageKind(b));
}

/**
 * How many containers, outermost first, the two paths share: the same name and the same type. A
 * container that kept its name but changed type (repeating rows become a group) stores its fields
 * differently, so a move out of it is judged as leaving it.
 */
function sharedDepth(
  a: readonly FieldDefinition[],
  b: readonly FieldDefinition[]
): number {
  let at = 0;
  while (
    at < a.length &&
    at < b.length &&
    nameOf(a[at]) === nameOf(b[at]) &&
    a[at].type === b[at].type
  ) {
    at += 1;
  }
  return at;
}

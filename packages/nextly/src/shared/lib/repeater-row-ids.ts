/**
 * Saved ids for repeater rows.
 *
 * A repeater is stored whole, as one JSON value, so a row has no identity of
 * its own unless the value carries one. Every write gives each row an `id`
 * here, at every depth: a repeater on the entry, in a group, in another
 * repeater's rows, and in a field group held inline in any of those. An id
 * lets a reader follow one row across saves, reorders and restores, and lets
 * the write paths pair a row with the one it replaces.
 *
 * The rule, per sent row of one list:
 * - a non-empty string id, the first time the list carries it, is kept;
 * - an id the list already carried earlier gets a fresh one;
 * - a row without one takes the stored row's id only where the match is
 *   unambiguous: the stored row at the same index, unchanged (equal once every
 *   `id` key is set aside), whose id no other row of the list carries. Any
 *   other row without one (moved, edited or inserted by a writer that sends no
 *   ids) gets a fresh id. Pairing it any looser way, by position alone, would
 *   hand a moved row another row's id.
 *
 * Each row's own fields are then walked with the stored row holding the same
 * final id, so a nested repeater's rows pair with the rows they replace.
 *
 * Run as the LAST step before a value is shaped for storage: after field-rule
 * merging and password keeping, so the ids never change what those decide,
 * and after populated references are reduced to ids, so an unchanged row
 * compares equal to the stored one.
 *
 * A field group placed directly on the entry is stored in its own table and
 * walked by that table's write, so an entry-level walk leaves it alone, as
 * the password walk does.
 *
 * @module shared/lib/repeater-row-ids
 */

import { randomUUID } from "node:crypto";

import { extractFieldGroupReferences } from "../../domains/field-groups/storage/field-group-field-type";

import {
  instanceFields,
  isPlainRecord,
  parsedValue,
  reachesFieldWhere,
  rewriteValue,
  sameInstance,
  type FieldGroupReach,
  type NamedField,
} from "./password-fields";
import { sameApartFromIds } from "./same-apart-from-ids";

/** What one walk carries through every level. */
interface RowIdWalk {
  reach: FieldGroupReach;
  newId: () => string;
}

/**
 * Give every repeater row in `data` an id, in place, at every depth, by the
 * rule in the module comment. `stored` is the value as stored (JSON text
 * allowed), or `undefined` for a create, where every row without an id gets a
 * fresh one. `stored` is only read, never changed. A container held as JSON
 * text in `data` is written back as text.
 *
 * `newId` is for tests; writes take a random UUID.
 */
export function assignRepeaterRowIds(
  data: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  fields: readonly NamedField[],
  reach: FieldGroupReach,
  newId: () => string = randomUUID
): void {
  assignLevel(data, stored, fields, { reach, newId }, true, new WeakSet());
}

/**
 * Whether `fields` can hold a repeater row, at any depth, through the field
 * groups `reach` follows: lets a write skip reading the stored value it would
 * pair rows with when there is nothing to pair.
 */
export function reachesRepeaterField(
  fields: readonly NamedField[],
  reach: FieldGroupReach
): boolean {
  return reachesFieldWhere(fields, reach, field => field.type === "repeater");
}

/** {@link assignRepeaterRowIds} at one level of the value. */
function assignLevel(
  level: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  fields: readonly NamedField[],
  walk: RowIdWalk,
  atEntry: boolean,
  open: WeakSet<object>
): void {
  for (const field of fields) {
    if (!field.name) {
      // A layout container keeps its fields on this level. `open` holds the
      // ones open on this path, so one that reaches itself terminates.
      if (!field.fields || open.has(field)) continue;
      open.add(field);
      assignLevel(level, stored, field.fields, walk, atEntry, open);
      open.delete(field);
      continue;
    }
    // Own keys only: a field may be named like a member every object inherits.
    if (!Object.hasOwn(level, field.name)) continue;
    const previous =
      stored && Object.hasOwn(stored, field.name)
        ? parsedValue(stored[field.name])
        : undefined;
    assignHeld(level, field.name, field, previous, walk, atEntry);
  }
}

/** {@link assignLevel} through the value one named field holds. */
function assignHeld(
  level: Record<string, unknown>,
  name: string,
  field: NamedField,
  previous: unknown,
  walk: RowIdWalk,
  atEntry: boolean
): void {
  // A container first: a reference rewritten into one keeps the slug it
  // named, and its fields already say what it holds.
  if (field.type === "repeater") {
    const rowFields = field.fields ?? [];
    // A repeater whose rows declare a field of their own named `id` keeps
    // that value as authored: its rows get no system id, and only what they
    // hold is walked.
    const assign = declaresOwnId(rowFields) ? walkRowsOnly : assignRows;
    rewriteValue(level, name, value => {
      if (Array.isArray(value)) {
        assign(value, Array.isArray(previous) ? previous : [], rowFields, walk);
      }
      return value;
    });
    return;
  }
  if (field.type === "group" && field.fields) {
    const groupFields = field.fields;
    rewriteValue(level, name, value => {
      if (isPlainRecord(value)) {
        const storedGroup = isPlainRecord(previous) ? previous : undefined;
        assignLevel(
          value,
          storedGroup,
          groupFields,
          walk,
          false,
          new WeakSet()
        );
      }
      return value;
    });
    return;
  }
  const references = extractFieldGroupReferences(field);
  if (references.single === undefined && references.many === undefined) {
    return;
  }
  // One placed directly on the entry is stored, and given its ids, by the
  // write of its own table.
  if (atEntry && walk.reach.direct !== true) return;
  rewriteValue(level, name, value => {
    assignInstances(value, previous, references, walk);
    return value;
  });
}

/**
 * Whether a repeater's rows declare a field named `id`, on the row itself or
 * through a layout container, which keeps its fields on the row.
 */
function declaresOwnId(fields: readonly NamedField[]): boolean {
  return fields.some(field =>
    field.name === undefined || field.name === ""
      ? declaresOwnId(field.fields ?? [])
      : field.name === "id"
  );
}

/**
 * The fields of rows given no id, each walked with the stored row at its
 * place: what that row holds is matched again by its own rules, which ask
 * for an unchanged row before any stored id passes on, so nothing moves.
 */
function walkRowsOnly(
  rows: unknown[],
  previous: readonly unknown[],
  fields: readonly NamedField[],
  walk: RowIdWalk
): void {
  rows.forEach((row, index) => {
    if (!isPlainRecord(row)) return;
    const atIndex = previous[index];
    const partner = isPlainRecord(atIndex) ? atIndex : undefined;
    assignLevel(row, partner, fields, walk, false, new WeakSet());
  });
}

/** The ids of one repeater's rows, then each row's own fields. */
function assignRows(
  rows: unknown[],
  previous: readonly unknown[],
  fields: readonly NamedField[],
  walk: RowIdWalk
): void {
  // Every id the list carries, so a row without one never takes a stored id
  // another row of the list names, wherever in the list that row is.
  const carried = new Set<string>();
  for (const row of rows) {
    const id = rowIdOf(row);
    if (id !== undefined) carried.add(id);
  }
  const storedById = new Map<string, Record<string, unknown>>();
  for (const storedRow of previous) {
    const id = rowIdOf(storedRow);
    if (id !== undefined && isPlainRecord(storedRow) && !storedById.has(id)) {
      storedById.set(id, storedRow);
    }
  }
  const used = new Set<string>();
  rows.forEach((row, index) => {
    if (!isPlainRecord(row)) return;
    const { id, partner } = rowIdentity(row, index, previous, {
      carried,
      used,
      storedById,
      newId: walk.newId,
    });
    used.add(id);
    row.id = id;
    assignLevel(row, partner, fields, walk, false, new WeakSet());
  });
}

/**
 * The id one sent row is stored under, and the stored row its own fields are
 * walked with: the one holding that id, or none for a fresh id.
 */
function rowIdentity(
  row: Record<string, unknown>,
  index: number,
  previous: readonly unknown[],
  list: {
    carried: ReadonlySet<string>;
    used: ReadonlySet<string>;
    storedById: ReadonlyMap<string, Record<string, unknown>>;
    newId: () => string;
  }
): { id: string; partner: Record<string, unknown> | undefined } {
  const given = rowIdOf(row);
  if (given !== undefined) {
    // A repeat names a row the list already has, so this one is a copy.
    if (list.used.has(given)) return { id: list.newId(), partner: undefined };
    return { id: given, partner: list.storedById.get(given) };
  }
  // Compared before anything below rewrites the row's nested ids.
  const atIndex = previous[index];
  const storedId = rowIdOf(atIndex);
  if (
    storedId !== undefined &&
    isPlainRecord(atIndex) &&
    !list.carried.has(storedId) &&
    !list.used.has(storedId) &&
    sameApartFromIds(row, atIndex)
  ) {
    return { id: storedId, partner: atIndex };
  }
  return { id: list.newId(), partner: undefined };
}

/**
 * {@link assignLevel} through the instances one inline field-group field
 * holds, each with the stored instance it replaces: by id, or, for one sent
 * without an id, the unchanged stored one at its index, as a row is paired.
 * An instance whose fields are not known is left as it is.
 */
function assignInstances(
  value: unknown,
  previous: unknown,
  references: { single?: string; many?: string[] },
  walk: RowIdWalk
): void {
  // An untyped zone row's schema is a guess, so nothing is walked in it.
  const lookup = { reach: walk.reach, untypedZoneRows: "unknown" as const };
  const visit = (
    instance: Record<string, unknown>,
    storedInstance: Record<string, unknown> | undefined
  ) => {
    const fields = instanceFields(instance, references, lookup);
    if (fields === undefined) return;
    // Paired only with a stored instance of the same field group.
    const partner =
      storedInstance &&
      instanceFields(storedInstance, references, lookup) === fields
        ? storedInstance
        : undefined;
    assignLevel(instance, partner, fields, walk, false, new WeakSet());
  };
  if (Array.isArray(value)) {
    const storedList = Array.isArray(previous) ? previous : [];
    value.forEach((instance, index) => {
      if (!isPlainRecord(instance)) return;
      visit(instance, storedInstanceFor(instance, index, storedList));
    });
    return;
  }
  if (isPlainRecord(value)) {
    visit(
      value,
      isPlainRecord(previous) && sameInstance(value, previous)
        ? previous
        : undefined
    );
  }
}

/** The stored instance one sent instance of a list replaces, if any. */
function storedInstanceFor(
  instance: Record<string, unknown>,
  index: number,
  storedList: readonly unknown[]
): Record<string, unknown> | undefined {
  const id = rowIdOf(instance);
  if (id !== undefined) {
    const match = storedList.find(stored => rowIdOf(stored) === id);
    return isPlainRecord(match) ? match : undefined;
  }
  const atIndex = storedList[index];
  return isPlainRecord(atIndex) &&
    rowIdOf(atIndex) === undefined &&
    sameApartFromIds(instance, atIndex)
    ? atIndex
    : undefined;
}

/** A row's own id: a non-empty string, or none. */
function rowIdOf(row: unknown): string | undefined {
  return isPlainRecord(row) && typeof row.id === "string" && row.id !== ""
    ? row.id
    : undefined;
}

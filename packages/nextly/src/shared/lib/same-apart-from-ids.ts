/**
 * Whether two rows hold the same values once the ids the system gives rows
 * are set aside: the test by which a row sent without its id is known to be
 * the stored row at its place, for its id and for the passwords it keeps.
 *
 * Only the system's ids are set aside, read from the schema: a repeater row's
 * own `id`, at any depth, and an inline field-group instance's. An `id` the
 * schema declares as a field is the author's value, and is compared like any
 * other: two rows told apart only by it are different rows. A reference is
 * compared as the reference a write stores, so a row read at depth, with
 * its relationships populated, still matches the row stored from it.
 *
 * @module shared/lib/same-apart-from-ids
 */
import { declaresOwnId } from "../../collections/fields/repeater-row-identity";
import { normalizeRelationshipValue } from "../../domains/collections/services/collection-utils";

import { deepEqual } from "./deep-equal";

/** The field shape this reads: a name, a type, and the fields it holds. */
interface RowField {
  readonly name?: string;
  readonly type: string;
  readonly fields?: readonly RowField[];
  /** A relationship's target, a list where it may point at several. */
  readonly relationTo?: unknown;
}

/**
 * The fields of one inline field-group instance a field holds, or nothing
 * where the field is no field-group field or the instance's fields are not
 * known. Given by the caller, which knows the field groups the write reaches.
 */
export type InstanceFieldsOf = (
  field: RowField,
  instance: Record<string, unknown>
) => readonly RowField[] | undefined;

/** How a value is copied for comparison: the instance schemas it can read. */
interface Copying {
  readonly instanceFields: InstanceFieldsOf | undefined;
}

/**
 * Whether a sent row holds what the stored one does, once the system's row
 * ids are set aside. `fields` are the row's own fields; without them only
 * the row's own `id` is set aside, as for an instance whose fields are not
 * known. `instanceFields` opens inline field-group instances, so the row ids
 * of a repeater inside one are set aside too. A key holding `undefined`
 * counts as absent, as storing the value as JSON leaves it out.
 */
export function sameApartFromIds(
  sent: unknown,
  stored: unknown,
  fields?: readonly RowField[],
  instanceFields?: InstanceFieldsOf
): boolean {
  const copying: Copying = { instanceFields };
  return deepEqual(
    withoutRowIds(sent, fields, copying),
    withoutRowIds(stored, fields, copying)
  );
}

/** The named fields of one level, layout containers opened onto it. */
function namedFields(fields: readonly RowField[]): Map<string, RowField> {
  const named = new Map<string, RowField>();
  for (const field of fields) {
    if (field.name === undefined || field.name === "") {
      for (const [name, inner] of namedFields(field.fields ?? [])) {
        named.set(name, inner);
      }
    } else {
      named.set(field.name, field);
    }
  }
  return named;
}

/** A copy of one row without the id the system gives it, nor its rows'. */
function withoutRowIds(
  row: unknown,
  fields: readonly RowField[] | undefined,
  copying: Copying
): unknown {
  if (!isRecord(row)) return row;
  const own = fields === undefined || !declaresOwnId(fields);
  return copyLevel(row, fields, own, copying);
}

/**
 * One level copied for comparison: `dropId` leaves out its own `id`, and
 * each repeater it holds is copied row by row, each without its system id.
 * Values the schema does not describe are compared as they are.
 */
function copyLevel(
  level: Record<string, unknown>,
  fields: readonly RowField[] | undefined,
  dropId: boolean,
  copying: Copying
): Record<string, unknown> {
  const named = fields === undefined ? undefined : namedFields(fields);
  // A null prototype, so an own `__proto__` key is copied as a key and
  // compared, rather than setting the copy's prototype and dropping out.
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(level)) {
    if (child === undefined || (dropId && key === "id")) continue;
    const field = named?.get(key);
    out[key] = field === undefined ? child : copyHeld(child, field, copying);
  }
  return out;
}

/** How each kind of field's value is copied for comparison. */
const COPY_BY_TYPE: Readonly<
  Record<string, (value: unknown, field: RowField, copying: Copying) => unknown>
> = {
  // Reduced as a write reduces it, so a populated row equals its id.
  relationship: (value, field) =>
    normalizeRelationshipValue(value, Array.isArray(field.relationTo)),
  upload: value => uploadReference(value),
  repeater: (value, field, copying) =>
    Array.isArray(value)
      ? value.map(row => withoutRowIds(row, field.fields ?? [], copying))
      : value,
  group: (value, field, copying) =>
    isRecord(value)
      ? copyLevel(value, field.fields ?? [], false, copying)
      : value,
};

/** One field's value copied for comparison, by what the field is. */
function copyHeld(value: unknown, field: RowField, copying: Copying): unknown {
  const byType = COPY_BY_TYPE[field.type];
  if (byType !== undefined) return byType(value, field, copying);
  return copyInstances(value, field, copying);
}

/**
 * Inline field-group instances, each without its own id (the server's) and
 * with its repeaters' row ids set aside; any other value as it is.
 */
function copyInstances(
  value: unknown,
  field: RowField,
  copying: Copying
): unknown {
  const resolve = copying.instanceFields;
  if (resolve === undefined) return value;
  const copy = (instance: unknown): unknown => {
    if (!isRecord(instance)) return instance;
    const fields = resolve(field, instance);
    return fields === undefined
      ? instance
      : copyLevel(instance, fields, true, copying);
  };
  return Array.isArray(value) ? value.map(copy) : copy(value);
}

/** An upload's value as the id it stores: a populated file is its id. */
function uploadReference(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(uploadReference);
  return isRecord(value) && "id" in value ? value.id : value;
}

/** A non-null, non-array object that isn't a date. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

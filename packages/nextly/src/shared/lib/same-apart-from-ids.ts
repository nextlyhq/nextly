/**
 * Whether two rows hold the same values once the ids the system gives rows
 * are set aside: the test by which a row sent without its id is known to be
 * the stored row at its place, for its id and for the passwords it keeps.
 *
 * Only the system's ids are set aside, read from the schema: a repeater row's
 * own `id`, at any depth, and an inline field-group instance's. An `id` the
 * schema declares as a field is the author's value, and is compared like any
 * other: two rows told apart only by it are different rows.
 *
 * @module shared/lib/same-apart-from-ids
 */
import { deepEqual } from "./deep-equal";

/** The field shape this reads: a name, a type, and the fields it holds. */
interface RowField {
  readonly name?: string;
  readonly type: string;
  readonly fields?: readonly RowField[];
}

/**
 * Whether a repeater's rows declare a field named `id`, on the row itself or
 * through a layout container, which keeps its fields on the row. Such a
 * row's `id` is the author's, so the system gives the row none.
 */
export function declaresOwnId(fields: readonly RowField[]): boolean {
  return fields.some(field =>
    field.name === undefined || field.name === ""
      ? declaresOwnId(field.fields ?? [])
      : field.name === "id"
  );
}

/**
 * Whether a sent row holds what the stored one does, once the system's row
 * ids are set aside. `fields` are the row's own fields; without them only
 * the row's own `id` is set aside, as for an instance whose fields are not
 * known. A key holding `undefined` counts as absent, as storing the value as
 * JSON leaves it out.
 */
export function sameApartFromIds(
  sent: unknown,
  stored: unknown,
  fields?: readonly RowField[]
): boolean {
  return deepEqual(withoutRowIds(sent, fields), withoutRowIds(stored, fields));
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
  fields: readonly RowField[] | undefined
): unknown {
  if (!isRecord(row)) return row;
  const own = fields === undefined || !declaresOwnId(fields);
  return copyLevel(row, fields, own);
}

/**
 * One level copied for comparison: `dropId` leaves out its own `id`, and
 * each repeater it holds is copied row by row, each without its system id.
 * Values the schema does not describe are compared as they are.
 */
function copyLevel(
  level: Record<string, unknown>,
  fields: readonly RowField[] | undefined,
  dropId: boolean
): Record<string, unknown> {
  const named = fields === undefined ? undefined : namedFields(fields);
  // A null prototype, so an own `__proto__` key is copied as a key and
  // compared, rather than setting the copy's prototype and dropping out.
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(level)) {
    if (child === undefined || (dropId && key === "id")) continue;
    out[key] = copyHeld(child, named?.get(key));
  }
  return out;
}

/** One field's value copied for comparison, by what the field is. */
function copyHeld(value: unknown, field: RowField | undefined): unknown {
  if (field?.type === "repeater" && Array.isArray(value)) {
    return value.map(row => withoutRowIds(row, field.fields ?? []));
  }
  if (field?.type === "group" && isRecord(value)) {
    return copyLevel(value, field.fields ?? [], false);
  }
  return value;
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

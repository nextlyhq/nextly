/**
 * What a Single's read takes from the database for a `select`.
 *
 * A read that names its fields reads only their columns, so a column the
 * caller left out is never named in the SQL: a field added in code whose
 * column `nextly migrate` has not created yet fails only the reads that ask
 * for it. The columns every read needs are always taken: the system columns
 * (the id, the lifecycle status, the timestamps, the version counter and the
 * last changer), whatever the caller selected.
 *
 * Pure: whether the read may narrow at all (read hooks and field rules see the
 * whole document) is the service's question, passed in as `wholeRow`.
 *
 * @module domains/singles/services/single-read-plan
 */

import { getColumns, type Table } from "drizzle-orm";

import { SYSTEM_COLUMNS } from "../../../lib/system-columns";
import { addressableFields } from "../../../shared/addressable-fields";
import {
  type FieldSelection,
  selectedTopLevelFields,
} from "../../../shared/lib/field-selection";
import { columnsDeclaredBy } from "../../schema/services/field-column-descriptor";

/** What one read of a Single's row takes. */
export interface SingleReadPlan<F> {
  /**
   * The physical columns of the Single's own table to read, or `undefined` to
   * read every column. A name the table does not carry (a translatable field's,
   * kept in the translations table) is left out by the adapter's projection.
   */
  columns: string[] | undefined;
  /**
   * The fields the read assembles (translations, uploads, relationships,
   * components): the selected ones, or every field when nothing narrows.
   */
  fields: F[];
}

/** The system columns a Single's table carries, each read whatever is selected. */
const SINGLE_SYSTEM_COLUMNS: readonly string[] = SYSTEM_COLUMNS.filter(column =>
  column.appliesTo.includes("single")
).map(column => column.name);

/**
 * The columns and fields one read of a Single takes for `select`.
 *
 * Every column and field when `wholeRow` is set, or when the selection
 * includes nothing (the read then answers the whole document, so it needs all
 * of it). Otherwise the system columns and the columns of the fields the
 * selection names at the top level (`author.name` names `author`), with a
 * field inside an unnamed layout group found where its value is stored. A
 * name that is no field of the Single adds nothing.
 */
export function singleReadPlan<
  F extends { name?: unknown; type?: unknown },
>(args: {
  fields: readonly F[];
  select: FieldSelection | undefined;
  wholeRow: boolean;
}): SingleReadPlan<F> {
  const selected = selectedTopLevelFields(args.select);
  if (args.wholeRow || selected.size === 0) {
    return { columns: undefined, fields: [...args.fields] };
  }
  // The same elements the caller passed, reached through layout groups: the
  // walk returns the fields themselves, never copies.
  const stored = addressableFields(args.fields) as unknown as F[];
  const topLevel = new Set<F>(args.fields);
  const fields = stored
    .filter(field => typeof field.name === "string" && selected.has(field.name))
    // A field reached through a group with no name is shared whatever it says: which fields
    // are translated is read from the declared list, where the group, not the field, stands,
    // so the column is on the main row (`fieldsStoredOnRow`). Said so on the copy the read is
    // described by, or the translations table read for a selection named a column it never had.
    .map(field =>
      topLevel.has(field) ? field : { ...field, localized: false }
    );
  const columns = new Set<string>(SINGLE_SYSTEM_COLUMNS);
  for (const column of columnsDeclaredBy(fields)) {
    columns.add(column);
  }
  return { columns: [...columns], fields };
}

/**
 * The projection of a Drizzle table that reads `columns` alone, keyed by each
 * column's property name so a row keeps the shape a whole read gives. A name
 * the table does not carry is left out, as the adapter's own projection
 * leaves it.
 */
export function tableProjection(
  table: unknown,
  columns: readonly string[]
): Record<string, unknown> {
  const wanted = new Set(columns);
  return Object.fromEntries(
    Object.entries(getColumns(table as Table)).filter(([, column]) =>
      wanted.has(column.name)
    )
  );
}

/**
 * Which columns the schema being applied makes unique: a field marked `unique`, found by its column,
 * or a single-column unique index on the table, which a collection can declare in `indexes` without
 * the field saying so (and which a unique field becomes too, where its uniqueness can be an index).
 *
 * The classifier asks it before offering "fill with one value" for a column made required: one value
 * written to every row it fills repeats in a unique column, or collides with a value a row already
 * holds, so that answer is never offered for one.
 *
 * @module domains/schema/pipeline/unique-columns
 */
import { toSnakeCase } from "../services/field-column-descriptor";

import type { NextlySchemaSnapshot } from "./diff/types";
import type { DesiredSchema } from "./types";

const keyOf = (table: string, column: string) =>
  `${table.toLowerCase()}.${column.toLowerCase()}`;

/** Whether `table.column` is unique in the schema being applied, read once from both sources. */
export function uniqueColumnLookup(
  snapshot: NextlySchemaSnapshot,
  desired: DesiredSchema
): (table: string, column: string) => boolean {
  const unique = new Set<string>();
  for (const table of snapshot.tables) {
    for (const index of table.indexes ?? []) {
      if (index.unique && index.columns.length === 1) {
        unique.add(keyOf(table.name, index.columns[0]));
      }
    }
  }
  for (const entity of [
    ...Object.values(desired.collections),
    ...Object.values(desired.singles),
    ...Object.values(desired.components),
  ]) {
    for (const field of entity.fields) {
      if (
        typeof field.name === "string" &&
        "unique" in field &&
        field.unique === true
      ) {
        unique.add(keyOf(entity.tableName, toSnakeCase(field.name)));
      }
    }
  }
  return (table, column) => unique.has(keyOf(table, column));
}

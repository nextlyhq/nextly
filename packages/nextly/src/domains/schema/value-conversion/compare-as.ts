// How a field reads its values, which decides when a converted value "reads back the same".
//
// One rule for every path that judges a conversion: a repair asks it of the field a difference
// belongs to, and `db:sync` and the development push of the field whose column they convert.
//
// @module domains/schema/value-conversion/compare-as

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isJsonBacked } from "../../../shared/lib/normalize-stored-value";

import { parseColumnType } from "./column-type";
import type { ColumnType, CompareAs } from "./types";

/**
 * As JSON where the new column is JSON or the field's value is stored as JSON (`isJsonBacked`, the
 * one rule for that; on SQLite such a column is text), as a number for a single number, exactly
 * otherwise. A column no field is known for (a table no entity declares) is read by its new type
 * alone: as JSON when it becomes JSON, exactly otherwise.
 */
export function compareAsFor(
  field: FieldDefinition | undefined,
  expected: ColumnType
): CompareAs {
  if (parseColumnType(expected).family === "json") return "json";
  if (field === undefined) return "exact";
  if (isJsonBacked(field)) return "json";
  if (field.type === "number" && field.hasMany !== true) return "number";
  return "exact";
}

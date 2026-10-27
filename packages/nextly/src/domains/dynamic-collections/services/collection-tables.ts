/**
 * The tables a collection owns, by name: its own table, its translation
 * table and the junction tables of its many-to-many fields.
 *
 * Kept as the one answer, because the drop file a delete writes and the
 * check that runs before it must name the same tables: a check that missed a
 * junction would let the drop take another owner's column with it.
 *
 * @module domains/dynamic-collections/services/collection-tables
 */
import { usesJunctionTable } from "../../schema/services/field-column-descriptor";

/**
 * The parts of a stored field that name its junction table. Structural, since
 * both a Builder field definition and a code-first field config reach here.
 */
interface JunctionField {
  name?: string;
  type?: unknown;
  options?: unknown;
}

/** A field's relationship options, read without trusting their shape. */
function junctionOptionsOf(field: JunctionField): {
  junctionTable?: unknown;
  target?: unknown;
} {
  return typeof field.options === "object" && field.options !== null
    ? field.options
    : {};
}

/**
 * The junction table a many-to-many field's links live in: the author's own
 * name when the field sets one, else one derived from both tables, sorted so
 * either side derives the same name, and the field.
 */
export function junctionTableNameFor(
  sourceTableName: string,
  field: JunctionField
): string {
  const options = junctionOptionsOf(field);
  if (typeof options.junctionTable === "string" && options.junctionTable) {
    return options.junctionTable;
  }
  const targetTable = `dc_${typeof options.target === "string" ? options.target : ""}`;
  const [first, second] = [sourceTableName, targetTable].sort();
  return `${first}_${second}_${field.name ?? ""}`;
}

/** The junction tables of a collection's own many-to-many fields. */
export function junctionTablesOf(
  tableName: string,
  fields: readonly JunctionField[]
): string[] {
  return fields
    .filter(usesJunctionTable)
    .map(field => junctionTableNameFor(tableName, field));
}

/**
 * Every table a collection owns: its own first, then its translation table
 * (named whether or not it exists, since a delete drops it if it does), then
 * its junction tables.
 */
export function collectionOwnTables(
  tableName: string,
  fields: readonly JunctionField[]
): string[] {
  return [
    tableName,
    `${tableName}_locales`,
    ...junctionTablesOf(tableName, fields),
  ];
}

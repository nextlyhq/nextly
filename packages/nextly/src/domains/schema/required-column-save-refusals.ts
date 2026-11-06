/**
 * A collection or Single schema save that makes columns required over rows that would break them,
 * counted before any statement runs.
 *
 * A save writes its ALTER from the field lists, and the database finds out about the rows only
 * when the `SET NOT NULL` (or the `ADD COLUMN ... NOT NULL`) runs, by which time MySQL has
 * committed the statements ahead of it. Both saves already ask their entries' preconditions first
 * (`refusalsForCollectionSave`); this is one of them. Every column the save would break is counted
 * with the one counter every road shares (`countRowsBreakingNotNull`), and each is refused in the
 * words every road uses (`requiredColumnOverNullsError`): the entity, the field and the count.
 *
 * A column the live table does not have yet is left to the ALTER generator, which refuses it on
 * its own terms (`REQUIRED_COLUMN_NOT_YET_APPLIED`): there is nothing to count in it.
 *
 * @module domains/schema/required-column-save-refusals
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ValidationPublicData } from "../../errors/public-data";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

import { countRowsBreakingNotNull } from "./pipeline/classifier/count-helpers";
import {
  requiredColumnOverNullsError,
  type RequiredColumnBreak,
  type RequiredColumnEntity,
  requiredColumnUncountedError,
} from "./required-column-refusal";
import {
  fieldProducesColumn,
  getColumnDescriptor,
  toSnakeCase,
  usesJunctionTable,
} from "./services/field-column-descriptor";

/** Whether a field keeps a column on the entity's own row. */
function hasOwnColumn(field: FieldDefinition): boolean {
  return fieldProducesColumn(field) && !usesJunctionTable(field);
}

/**
 * Whether the save writes the field's column NOT NULL, as the descriptor builds it: a required
 * relationship's foreign key stays nullable, its requiredness enforced when an entry is saved.
 */
function columnIsNotNull(
  field: FieldDefinition,
  dialect: SupportedDialect
): boolean {
  const descriptor = getColumnDescriptor(field, dialect, "collection");
  return descriptor !== null && !descriptor.nullable;
}

/**
 * What a field the save makes required has in its way: its column as the live table holds it
 * (before any rename in this save), `null` for a column created now (every row), or undefined
 * when nothing can be in its way: a column the save leaves nullable (not required, or a
 * relationship's), no column of its own, one already NOT NULL, a column the table does not have
 * yet (left to its own refusal), or one created holding a value.
 */
function columnToCount(
  field: FieldDefinition,
  args: {
    dialect: SupportedDialect;
    previousOf: (field: FieldDefinition) => FieldDefinition | undefined;
    addedColumnBackfill: (field: FieldDefinition) => string | null;
    presentColumns: ReadonlySet<string>;
  }
): { column: string | null } | undefined {
  if (!hasOwnColumn(field) || !columnIsNotNull(field, args.dialect)) {
    return undefined;
  }
  const previous = args.previousOf(field);
  if (previous !== undefined && hasOwnColumn(previous)) {
    if (columnIsNotNull(previous, args.dialect)) return undefined;
    const held = toSnakeCase(previous.name);
    return args.presentColumns.has(held) ? { column: held } : undefined;
  }
  // Added, or moved onto the row from another table: a column created now. One whose type gives
  // the existing rows a value leaves none of them empty.
  return args.addedColumnBackfill(field) === null
    ? { column: null }
    : undefined;
}

/**
 * The refusals for a save of `entity`'s table, one per field the save makes required over rows
 * holding no value in it, in the order the fields are declared. Empty when no row is in the way.
 *
 * @param args.previousOf - What the save says a field was, by identity: a renamed field is the
 *   same column under its old name, and its nulls are counted there.
 * @param args.addedColumnBackfill - The value an added column gives existing rows (the ALTER
 *   generator's answer), or null when they get NULL.
 * @param args.presentColumns - The columns the live table has.
 */
export async function requiredColumnSaveRefusals(args: {
  db: unknown;
  dialect: SupportedDialect;
  entity: RequiredColumnEntity;
  tableName: string;
  newFields: readonly FieldDefinition[];
  previousOf: (field: FieldDefinition) => FieldDefinition | undefined;
  addedColumnBackfill: (field: FieldDefinition) => string | null;
  presentColumns: ReadonlySet<string>;
}): Promise<ValidationPublicData["errors"]> {
  // A count that fails refuses the save before anything runs, naming the table and the field.
  const count = async (column: string | null, field: string) => {
    try {
      return (
        await countRowsBreakingNotNull(args.db, args.dialect, {
          table: args.tableName,
          column,
        })
      ).total;
    } catch (cause) {
      throw requiredColumnUncountedError({
        table: args.tableName,
        field,
        cause,
      });
    }
  };
  // Every row is in the way of each added column, so the table is counted once.
  let rows: number | undefined;

  const breaks: RequiredColumnBreak[] = [];
  for (const field of args.newFields) {
    const target = columnToCount(field, args);
    if (target === undefined) continue;
    const found =
      target.column === null
        ? (rows ??= await count(null, field.name))
        : await count(target.column, field.name);
    if (found > 0) {
      breaks.push({
        entity: args.entity,
        field: field.name,
        count: found,
        added: target.column === null,
      });
    }
  }
  if (breaks.length === 0) return [];
  // The entries of the one refusal every road gives, so this save's words are that refusal's.
  const data = requiredColumnOverNullsError(breaks).publicData;
  return data !== undefined && "errors" in data ? data.errors : [];
}

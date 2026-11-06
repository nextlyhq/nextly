/**
 * A relationship switched from many related entries to one, refused before anything runs while a
 * row holds more than one: one reference cannot keep a list's second id, so converting would drop
 * it. A row holding one id, or none, converts losslessly (`referenceScalar`).
 *
 * Counted on the database as it stands, with the list column's own JSON length, and named the way
 * every schema refusal names its subject: the entity, the field and how many rows.
 *
 * @module domains/schema/pipeline/several-references-refusal
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors";
import { toSnakeCase } from "../services/field-column-descriptor";

import { querySqlRows } from "./classifier/count-helpers";
import type { NextlySchemaSnapshot, Operation } from "./diff/types";
import { liveTableName, renamesOf, type ApplyRenames } from "./live-uniques";
import { targetSwitches } from "./reference-storage-switch";
import type { DesiredSchema } from "./types";

/** Each dialect's condition on a column, given its quoted identifier. */
type RowCondition = Record<SupportedDialect, (c: SQL) => SQL>;

/** How many rows of `table` meet `condition` on `column`. */
function rowsWhere(
  dialect: SupportedDialect,
  table: string,
  column: string,
  condition: RowCondition
): SQL {
  return sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE ${condition[dialect](sql.identifier(column))}`;
}

/**
 * A JSON list of more than one reference. A CASE rather than AND: no dialect promises to evaluate
 * AND left to right, and the length read raises on a value that is not a JSON list (PostgreSQL on
 * an object, MySQL and SQLite on text that is not JSON, such as a bare id).
 */
const SEVERAL_REFERENCES: RowCondition = {
  postgresql: c =>
    sql`CASE WHEN jsonb_typeof(${c}::jsonb) = 'array' THEN jsonb_array_length(${c}::jsonb) > 1 ELSE FALSE END`,
  mysql: c =>
    sql`CASE WHEN JSON_VALID(${c}) THEN JSON_TYPE(${c}) = 'ARRAY' AND JSON_LENGTH(${c}) > 1 ELSE FALSE END`,
  sqlite: c =>
    sql`CASE WHEN json_valid(${c}) THEN json_type(${c}) = 'array' AND json_array_length(${c}) > 1 ELSE 0 END`,
};

/** A value: not NULL, an empty string, an empty list or JSON null. */
const HOLDS_A_VALUE: RowCondition = {
  postgresql: c =>
    sql`${c} IS NOT NULL AND btrim(${c}::text) NOT IN ('', '[]', 'null')`,
  mysql: c =>
    sql`${c} IS NOT NULL AND TRIM(CAST(${c} AS CHAR)) NOT IN ('', '[]', 'null')`,
  sqlite: c => sql`${c} IS NOT NULL AND trim(${c}) NOT IN ('', '[]', 'null')`,
};

/**
 * The table and column a desired table's column is found under in the database now: both refusals
 * count rows before any of the apply's renames has run.
 */
function liveNames(
  renames: ApplyRenames,
  table: string,
  column: string
): { table: string; column: string } {
  const renamedColumns = renames.desiredColumn.get(table.toLowerCase());
  const liveColumn = [...(renamedColumns ?? new Map<string, string>())].find(
    ([, desired]) => desired === column.toLowerCase()
  )?.[0];
  return {
    table: liveTableName(table, renames),
    column: liveColumn ?? column,
  };
}

/** The entity and field a table's column belongs to, as a refusal names them. */
function subjectOf(
  desired: DesiredSchema,
  table: string,
  column: string
): { label: string; field: string } {
  const kinds = [
    ["Collection", desired.collections],
    ["Single", desired.singles],
    ["Field group", desired.components],
  ] as const;
  for (const [kind, entities] of kinds) {
    for (const entity of Object.values(entities)) {
      if (entity.tableName.toLowerCase() !== table.toLowerCase()) continue;
      const field = entity.fields.find(
        f => typeof f.name === "string" && toSnakeCase(f.name) === column
      );
      return {
        label: `${kind} '${entity.slug}'`,
        field: typeof field?.name === "string" ? field.name : column,
      };
    }
  }
  return { label: `Table '${table}'`, field: column };
}

/**
 * Refuses the apply when a relationship it switches from many related entries to one has a row
 * holding more than one, before any statement runs.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_HOLDS_SEVERAL`) naming each such field and its rows
 */
export async function refuseSeveralReferencesForOne(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  operations: readonly Operation[];
}): Promise<void> {
  const errors: Array<{ path: string; code: string; message: string }> = [];
  const renames = renamesOf(args.operations);
  for (const op of args.operations) {
    if (
      op.type !== "change_column_type" ||
      op.conversion !== "referenceScalar"
    ) {
      continue;
    }
    const live = liveNames(renames, op.tableName, op.columnName);
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      rowsWhere(args.dialect, live.table, live.column, SEVERAL_REFERENCES)
    );
    const rows = Number(row?.n ?? 0);
    if (rows === 0) continue;
    const { label, field } = subjectOf(
      args.desired,
      op.tableName,
      op.columnName
    );
    const those = rows === 1 ? "that row" : "those rows";
    errors.push({
      path: `fields.${field}`,
      code: "RELATIONSHIP_HOLDS_SEVERAL",
      // Worded for the column rather than the field it was: a list a non-relation field held (such
      // as chips changed into a relationship) reaches this refusal too.
      message: `${label}: field '${field}' cannot change to a single related entry while ${rows === 1 ? "1 row holds" : `${String(rows)} rows hold`} more than one value. Remove the extra values from ${those} first, or keep the field holding many.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-holds-several-for-one" },
  });
}

/**
 * Refuses the apply when a relationship it switches to or from naming several target collections
 * has a row holding a value, before any statement runs.
 *
 * Such a relation stores `{ relationTo, value }` references, and the other side stores bare ids:
 * no conversion makes one from the other without guessing a target or dropping one, and a column
 * left holding the old shape is read wrongly. A column with no values switches as any other does.
 * Only a column the live table has is counted, under the name it has there before the apply's
 * renames: a relation backed by a junction table has none.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_TARGETS_HOLD_VALUES`) naming each such field and its rows
 */
export async function refuseTargetSwitchesOverValues(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  live: NextlySchemaSnapshot;
  /** The apply's operations, whose renames say where each column is found now. */
  operations: readonly Operation[];
}): Promise<void> {
  const renames = renamesOf(args.operations);
  const liveColumns = new Set(
    args.live.tables.flatMap(table =>
      table.columns.map(
        column => `${table.name.toLowerCase()}.${column.name.toLowerCase()}`
      )
    )
  );
  const errors: Array<{ path: string; code: string; message: string }> = [];
  for (const each of targetSwitches(args.desired)) {
    const live = liveNames(renames, each.tableName, each.columnName);
    const key = `${live.table.toLowerCase()}.${live.column.toLowerCase()}`;
    if (!liveColumns.has(key)) continue;
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      rowsWhere(args.dialect, live.table, live.column, HOLDS_A_VALUE)
    );
    const rows = Number(row?.n ?? 0);
    if (rows === 0) continue;
    const those = rows === 1 ? "that row" : "those rows";
    errors.push({
      path: `fields.${each.field}`,
      code: "RELATIONSHIP_TARGETS_HOLD_VALUES",
      message: `${each.label}: field '${each.field}' cannot change how its related entries are stored (between one target collection and several, or one entry and many across several) while ${rows === 1 ? "1 row holds" : `${String(rows)} rows hold`} a value. Clear the field on ${those} first, or keep its targets as they are.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-target-switch-over-values" },
  });
}

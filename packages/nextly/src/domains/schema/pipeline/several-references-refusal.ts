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
import { conversionBetweenShapes } from "./diff/types";
import { liveTableName, renamesOf, type ApplyRenames } from "./live-uniques";
import type { DesiredSchema } from "./types";

/** Each dialect's condition on a column, given its quoted identifier. */
type RowCondition = Record<
  SupportedDialect,
  (c: ReturnType<typeof sql.identifier>) => SQL
>;

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

/** An empty JSON list: a relation holding no entry. Guarded by CASE as the condition above is. */
const NO_REFERENCES: RowCondition = {
  postgresql: c =>
    sql`CASE WHEN jsonb_typeof(${c}::jsonb) = 'array' THEN jsonb_array_length(${c}::jsonb) = 0 ELSE FALSE END`,
  mysql: c =>
    sql`CASE WHEN JSON_VALID(${c}) THEN JSON_TYPE(${c}) = 'ARRAY' AND JSON_LENGTH(${c}) = 0 ELSE FALSE END`,
  sqlite: c =>
    sql`CASE WHEN json_valid(${c}) THEN json_type(${c}) = 'array' AND json_array_length(${c}) = 0 ELSE 0 END`,
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
  // A translated field's column is on its entity's companion, named for the main table.
  const mainTable = table.toLowerCase().replace(/_locales$/, "");
  for (const [kind, entities] of kinds) {
    for (const entity of Object.values(entities)) {
      if (entity.tableName.toLowerCase() !== mainTable) continue;
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

/** A refusal's entry: the field it names, its code and its message. */
interface RefusalError {
  path: string;
  code: string;
  message: string;
}

/** `rows` counted, as a refusal words it: "1 row holds", "3 rows hold". */
function rowsHold(rows: number): string {
  return rows === 1 ? "1 row holds" : `${String(rows)} rows hold`;
}

/**
 * What a switch of `op`'s column to one reference finds in the rows it would convert: a row holding
 * several, whose extra values one reference cannot keep, and, where the live column is NOT NULL, a
 * row holding none, which would become NULL in a column that refuses it (PostgreSQL fails its single
 * statement, MySQL's restated column would let the NULL in, SQLite fails the rewrite).
 */
async function oneReferenceRefusals(
  args: { db: unknown; dialect: SupportedDialect; desired: DesiredSchema },
  op: Extract<Operation, { type: "change_column_type" }>,
  live: { table: string; column: string; notNull: boolean }
): Promise<RefusalError[]> {
  const count = async (condition: RowCondition): Promise<number> => {
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      rowsWhere(args.dialect, live.table, live.column, condition)
    );
    return Number(row?.n ?? 0);
  };
  const { label, field } = subjectOf(args.desired, op.tableName, op.columnName);
  const errors: RefusalError[] = [];
  const several = await count(SEVERAL_REFERENCES);
  if (several > 0) {
    const those = several === 1 ? "that row" : "those rows";
    errors.push({
      path: `fields.${field}`,
      code: "RELATIONSHIP_HOLDS_SEVERAL",
      // Worded for the column rather than the field it was: a list a non-relation field held (such
      // as chips changed into a relationship) reaches this refusal too.
      message: `${label}: field '${field}' cannot change to a single related entry while ${rowsHold(several)} more than one value. Remove the extra values from ${those} first, or keep the field holding many.`,
    });
  }
  const none = live.notNull ? await count(NO_REFERENCES) : 0;
  if (none > 0) {
    const those = none === 1 ? "that row" : "those rows";
    errors.push({
      path: `fields.${field}`,
      code: "RELATIONSHIP_REQUIRED_HOLDS_NONE",
      message: `${label}: field '${field}' is required and cannot change to a single related entry while ${rowsHold(none)} none. Give ${those} an entry first, or make the field optional.`,
    });
  }
  return errors;
}

/**
 * Refuses the apply when a relationship it switches from many related entries to one has a row
 * holding more than one, or, in a column that refuses NULL, a row holding none, before any
 * statement runs.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_HOLDS_SEVERAL` or `RELATIONSHIP_REQUIRED_HOLDS_NONE`)
 *   naming each such field and its rows
 */
export async function refuseSeveralReferencesForOne(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  /** The tables as they stand, for each column's nullability before the apply. */
  live: NextlySchemaSnapshot;
  operations: readonly Operation[];
}): Promise<void> {
  const errors: RefusalError[] = [];
  const renames = renamesOf(args.operations);
  const notNull = new Set(
    args.live.tables.flatMap(table =>
      table.columns
        .filter(column => column.nullable === false)
        .map(
          column => `${table.name.toLowerCase()}.${column.name.toLowerCase()}`
        )
    )
  );
  for (const op of args.operations) {
    if (
      op.type !== "change_column_type" ||
      op.conversion !== "referenceScalar"
    ) {
      continue;
    }
    const live = liveNames(renames, op.tableName, op.columnName);
    errors.push(
      ...(await oneReferenceRefusals(args, op, {
        ...live,
        notNull: notNull.has(
          `${live.table.toLowerCase()}.${live.column.toLowerCase()}`
        ),
      }))
    );
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
 * left holding the old shape is read wrongly. The diff plans each such switch as a guard requiring
 * the column empty (`requireEmpty`); this counts its rows under the names they have before the
 * apply's renames, so the refusal names the field rather than the guard's statement failing. A
 * column with no values switches as any other does.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_TARGETS_HOLD_VALUES`) naming each such field and its rows
 */
export async function refuseTargetSwitchesOverValues(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  /** The apply's operations: its guards, and its renames, which say where each column is now. */
  operations: readonly Operation[];
}): Promise<void> {
  const renames = renamesOf(args.operations);
  const errors: RefusalError[] = [];
  for (const op of args.operations) {
    if (op.type !== "change_column_type" || op.conversion !== "requireEmpty") {
      continue;
    }
    const live = liveNames(renames, op.tableName, op.columnName);
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      rowsWhere(args.dialect, live.table, live.column, HOLDS_A_VALUE)
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
      code: "RELATIONSHIP_TARGETS_HOLD_VALUES",
      message: `${label}: field '${field}' cannot change how its related entries are stored (between one target collection and several, or one entry and many across several) while ${rowsHold(rows)} a value. Clear the field on ${those} first, or keep its targets as they are.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-target-switch-over-values" },
  });
}

/** The column `column` of `table` in `snapshot`, case-insensitively. */
function columnOf(
  snapshot: NextlySchemaSnapshot,
  table: string,
  column: string
): NextlySchemaSnapshot["tables"][number]["columns"][number] | undefined {
  return snapshot.tables
    .find(t => t.name.toLowerCase() === table.toLowerCase())
    ?.columns.find(c => c.name.toLowerCase() === column.toLowerCase());
}

/**
 * Refuses a relation renamed and switched between storage shapes in one change, before anything
 * runs. A rename moves the column's values to the new name as they are, so the switch's conversion,
 * planned for one name, reaches none of them; and the two are judged from the rename's two ends,
 * the shape the column had under its old name and the shape it has under its new one.
 *
 * @throws NextlyError (validation, `RELATIONSHIP_SWITCH_WITH_RENAME`) naming each such field
 */
export function refuseSwitchesWithRename(args: {
  /** The change's entities, to name each field as its entity; absent, the table is named. */
  desired?: DesiredSchema;
  operations: readonly Operation[];
  /** The tables before the change, each relation column stating the shape it had. */
  previous: NextlySchemaSnapshot;
  /** The tables after it, each relation column stating its shape. */
  next: NextlySchemaSnapshot;
}): void {
  const errors: RefusalError[] = [];
  for (const op of args.operations) {
    if (op.type !== "rename_column") continue;
    const was = columnOf(args.previous, op.tableName, op.fromColumn);
    const now = columnOf(args.next, op.tableName, op.toColumn);
    const switched = conversionBetweenShapes(
      was?.referenceShape,
      now?.referenceShape
    );
    if (switched === undefined) continue;
    const { label, field } =
      args.desired === undefined
        ? { label: `Table '${op.tableName}'`, field: op.toColumn }
        : subjectOf(args.desired, op.tableName, op.toColumn);
    errors.push({
      path: `fields.${field}`,
      code: "RELATIONSHIP_SWITCH_WITH_RENAME",
      message: `${label}: field '${field}' cannot be renamed and change how its related entries are stored in the same change. Make the two changes one at a time.`,
    });
  }
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "relationship-switch-with-rename" },
  });
}

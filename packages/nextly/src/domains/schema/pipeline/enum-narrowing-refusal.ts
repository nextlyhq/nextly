/**
 * An enum's values narrowed while a row still holds one of them, refused
 * before anything runs.
 *
 * An enum column is its CHECK (`enum-check.ts`): narrowing the values is a
 * `drop_check` plus an `add_check` the diff already emits, and the add is one
 * the database refuses while a row violates it. Left to the database the
 * refusal is correct but unusable — `check constraint "ck_..." is violated by
 * some row` names neither the column nor the value — and on MySQL the drop
 * ahead of it has already committed, leaving the column unconstrained. So the
 * apply asks first: every check the answered plan narrows is paired with the
 * check it replaces, the values the pair takes away are counted in the rows,
 * and an apply a row still holds one of them is refused naming the table, the
 * column, the values and the count. A narrowing nothing holds applies
 * freely, which is what makes the refusal about the rows rather than the
 * change.
 *
 * A pair is matched by the COLUMN each side constrains, read from the check's
 * own expression, so renaming the constraint (`col.enum(..., { name })`)
 * still narrows rather than falling to the database. A column the same apply
 * renames is followed through its rename: the old check names the column as
 * it stands, the new one the name it takes. A dropped check whose expression
 * cannot be read back — MySQL reports a literal holding a backslash in an
 * escaped form whose meaning depends on its `sql_mode` — is paired by its
 * constraint name instead, since the add it is replaced by is ours to read.
 *
 * What is refused is decided by the rows, not by the values the old check
 * listed: the rows outside the new set are counted, grouped by value, so a
 * pair whose old side could not be read is judged as surely as one whose
 * could, and the refusal names the values the rows actually hold.
 *
 * @module domains/schema/pipeline/enum-narrowing-refusal
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors";
import {
  enumColumnIn,
  enumValuesIn,
  removedEnumValues,
} from "../extension/enum-check";
import { toSnakeCase } from "../services/field-column-descriptor";

import { querySqlRows } from "./classifier/count-helpers";
import type { Operation } from "./diff/types";
import { liveTableName, renamesOf } from "./live-uniques";
import type { DesiredSchema } from "./types";

/** One check the plan narrows: the column it constrains and the values gone. */
interface Narrowing {
  /** The table as the operations name it. */
  table: string;
  /** The column the new check constrains, by the name the apply leaves it. */
  column: string;
  /** The same column as it stands before the apply: where its rows are counted. */
  liveColumn: string;
  /**
   * The values the pair takes away, in the order the old check listed them;
   * empty when the old check could not be read, where the rows name them.
   */
  values: string[];
  /** The values the replacement check keeps, evaluated by the database. */
  kept: string[];
}

/** The key a check's table and column pair by, folded as MySQL folds names. */
function pairKey(table: string, column: string): string {
  return `${table.toLowerCase()} ${column.toLowerCase()}`;
}

/** Each dropped check's SQL, under the keys an add may find it by. */
interface DroppedChecks {
  /** By the table and the column a readable enum check constrained. */
  byColumn: Map<string, string[]>;
  /** By the table and constraint name, for a check whose expression cannot be read. */
  unreadableByName: Map<string, string[]>;
}

function pushTo(map: Map<string, string[]>, key: string, sql: string): void {
  const list = map.get(key) ?? [];
  list.push(sql);
  map.set(key, list);
}

/**
 * Each dropped check, keyed by the column it constrained where its expression
 * is an enum set this module can read, and by its name where it cannot.
 */
function droppedChecks(operations: readonly Operation[]): DroppedChecks {
  const byColumn = new Map<string, string[]>();
  const unreadableByName = new Map<string, string[]>();
  for (const op of operations) {
    if (op.type !== "drop_check") continue;
    const column = enumColumnIn(op.check.sql);
    if (column === null) {
      pushTo(
        unreadableByName,
        pairKey(op.tableName, op.check.name),
        op.check.sql
      );
    } else {
      pushTo(byColumn, pairKey(op.tableName, column), op.check.sql);
    }
  }
  return { byColumn, unreadableByName };
}

/**
 * Table and new column name, lower-cased, to the column's name before the
 * apply, for every column the operations rename.
 */
function columnsBeforeRename(
  operations: readonly Operation[]
): Map<string, string> {
  const before = new Map<string, string>();
  for (const op of operations) {
    if (op.type !== "rename_column") continue;
    before.set(pairKey(op.tableName, op.toColumn), op.fromColumn);
  }
  return before;
}

/**
 * The check narrowings among the operations: each `add_check` whose expression
 * is an enum set, paired with the `drop_check` of the same table constraining
 * the same column — the column as it stood, where the apply renames it — or,
 * where the dropped check cannot be read, carrying the same name. Sides that
 * are not enum sets, pairs that only add, and sides naming unrelated columns
 * are not narrowings.
 */
export function checkNarrowings(operations: readonly Operation[]): Narrowing[] {
  const dropped = droppedChecks(operations);
  const renamedFrom = columnsBeforeRename(operations);
  const narrowings: Narrowing[] = [];
  for (const op of operations) {
    if (op.type !== "add_check") continue;
    const column = enumColumnIn(op.check.sql);
    const kept = enumValuesIn(op.check.sql);
    if (column === null || kept === null) continue;
    const liveColumn = renamedFrom.get(pairKey(op.tableName, column)) ?? column;
    const pair = { table: op.tableName, column, liveColumn, kept };
    for (const before of dropped.byColumn.get(
      pairKey(op.tableName, liveColumn)
    ) ?? []) {
      const values = removedEnumValues(before, op.check.sql);
      if (values.length > 0) narrowings.push({ ...pair, values });
    }
    // An unreadable old check may have allowed anything, so the rows decide.
    if (dropped.unreadableByName.has(pairKey(op.tableName, op.check.name))) {
      narrowings.push({ ...pair, values: [] });
    }
  }
  return narrowings;
}

/**
 * The non-null `column` values of `table` outside `kept`, each with how many
 * rows hold it.
 */
function rowsHolding(
  table: string,
  column: string,
  kept: readonly string[]
): SQL {
  // The values are bound parameters, never spelled into the statement: they
  // came out of a check's expression, and one holding a quote would escape
  // any quoting written by hand. Querying `NOT IN (kept)` rather than the
  // JS-derived removed set lets the column's own collation decide equivalence,
  // so values retained under case- or accent-insensitive comparisons are not
  // refused while NULL continues to pass CHECK.
  const col = sql.identifier(column);
  return sql`SELECT ${col} AS v, COUNT(*) AS n FROM ${sql.identifier(table)} WHERE ${col} IS NOT NULL AND ${col} NOT IN (${sql.join(
    kept.map(value => sql`${value}`),
    sql`, `
  )}) GROUP BY ${col}`;
}

/** The entity and field a table's column belongs to, as a refusal names them. */
function subjectOf(
  desired: DesiredSchema,
  table: string,
  column: string
): { label: string; field: string; isEntity: boolean } {
  const kinds = [
    ["Collection", desired.collections],
    ["Single", desired.singles],
    ["Field group", desired.components],
  ] as const;
  // A translated field's column is on its entity's companion, named for the main table.
  const mainTable = table.toLowerCase().replace(/_locales$/, "");
  const lowerColumn = column.toLowerCase();
  for (const [kind, entities] of kinds) {
    for (const entity of Object.values(entities)) {
      if (entity.tableName.toLowerCase() !== mainTable) continue;
      const fields = entity.fields as
        | ReadonlyArray<{ name?: string }>
        | undefined;
      const field = fields?.find(
        f => typeof f.name === "string" && toSnakeCase(f.name) === lowerColumn
      );
      return {
        label: `${kind} '${entity.slug}'`,
        field: typeof field?.name === "string" ? field.name : column,
        isEntity: true,
      };
    }
  }
  return { label: `Table '${table}'`, field: column, isEntity: false };
}

/**
 * The values a refusal names: those the rows hold, as the database returned
 * them, or the values the old check listed when the rows did not say.
 */
function heldValues(
  rows: ReadonlyArray<{ v?: unknown }>,
  listed: readonly string[]
): string {
  const fromRows = rows
    .map(row => row.v)
    .filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number"
    )
    .map(String);
  const names = fromRows.length > 0 ? fromRows : listed;
  if (names.length === 0) return "the values it no longer allows";
  return names.map(value => `'${value}'`).join(", ");
}

/** `rows` counted, as a refusal words it. */
function rowsHold(rows: number): string {
  return rows === 1 ? "1 row holds" : `${String(rows)} rows hold`;
}

/**
 * Refuses the apply, before any statement runs, when a check it narrows takes
 * a value away that a row still holds.
 *
 * Counted on the table and column as they stand now, under the names a rename
 * in the same apply is taking them from, so the rows the change would break
 * are the rows read.
 *
 * @throws NextlyError (validation, `ENUM_VALUE_HELD_BY_ROWS`) naming each such
 *   column and the rows in its way
 */
export async function refuseEnumNarrowingsOverRows(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  operations: readonly Operation[];
}): Promise<void> {
  const narrowings = checkNarrowings(args.operations);
  if (narrowings.length === 0) return;

  const renames = renamesOf(args.operations);
  const errors: Array<{ path: string; code: string; message: string }> = [];
  for (const narrowing of narrowings) {
    const table = liveTableName(narrowing.table, renames);
    const rows = await querySqlRows<{ v?: unknown; n: number | string }>(
      args.db,
      args.dialect,
      rowsHolding(table, narrowing.liveColumn, narrowing.kept)
    );
    const count = rows.reduce((sum, row) => sum + Number(row.n ?? 0), 0);
    if (count === 0) continue;
    const { label, field, isEntity } = subjectOf(
      args.desired,
      narrowing.table,
      narrowing.column
    );
    const those = count === 1 ? "that row" : "those rows";
    const values = heldValues(rows, narrowing.values);
    errors.push({
      path: isEntity ? `fields.${field}` : `tables.${narrowing.table}.${field}`,
      code: "ENUM_VALUE_HELD_BY_ROWS",
      message: `${label}: column '${narrowing.column}' cannot take ${values} away while ${rowsHold(count)} one of them. Move ${those} to a value that stays, or delete them, then apply again.`,
    });
  }
  if (errors.length > 0) {
    throw NextlyError.validation({
      errors,
      logContext: { reason: "enum-narrowing-over-rows" },
    });
  }
}

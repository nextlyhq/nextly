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
 * renames is followed through the rename: the old check, naming the live
 * column, pairs with the new one naming the desired column, and the rows are
 * counted under the live name, which is the one they hold before anything runs.
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
  /** The column the replacement check constrains, as the desired schema names it. */
  column: string;
  /** The same column as it is named now, before a rename in the apply runs. */
  liveColumn: string;
  /** The values the pair takes away, in the order the old check listed them. */
  values: string[];
  /** The values the replacement check keeps, evaluated by the database. */
  kept: string[];
}

/** The key a check's table and column pair by, folded as MySQL folds names. */
function pairKey(table: string, column: string): string {
  return `${table.toLowerCase()} ${column.toLowerCase()}`;
}

/** A dropped enum check, with the live column it constrained. */
interface DroppedCheck {
  sql: string;
  liveColumn: string;
}

/**
 * Each dropped enum check, by the table and the column it constrains once the
 * apply's column renames have run. A drop that is not an enum set constrains
 * nothing this refusal can read.
 */
function droppedEnumChecks(
  operations: readonly Operation[]
): Map<string, DroppedCheck[]> {
  const renamed = renamesOf(operations).desiredColumn;
  const dropped = new Map<string, DroppedCheck[]>();
  for (const op of operations) {
    if (op.type !== "drop_check") continue;
    const liveColumn = enumColumnIn(op.check.sql);
    if (liveColumn === null) continue;
    const column =
      renamed.get(op.tableName.toLowerCase())?.get(liveColumn.toLowerCase()) ??
      liveColumn;
    const key = pairKey(op.tableName, column);
    const list = dropped.get(key) ?? [];
    list.push({ sql: op.check.sql, liveColumn });
    dropped.set(key, list);
  }
  return dropped;
}

/**
 * The check narrowings among the operations: each `add_check` whose expression
 * is an enum set, paired with the `drop_check` of the same table constraining
 * the same column, followed through a rename of that column. Sides that are
 * not enum sets and pairs that only add are not narrowings.
 */
export function checkNarrowings(operations: readonly Operation[]): Narrowing[] {
  const dropped = droppedEnumChecks(operations);
  const narrowings: Narrowing[] = [];
  for (const op of operations) {
    if (op.type !== "add_check") continue;
    const column = enumColumnIn(op.check.sql);
    const kept = enumValuesIn(op.check.sql);
    if (column === null || kept === null) continue;
    for (const before of dropped.get(pairKey(op.tableName, column)) ?? []) {
      const values = removedEnumValues(before.sql, op.check.sql);
      if (values.length === 0) continue;
      narrowings.push({
        table: op.tableName,
        column,
        liveColumn: before.liveColumn,
        values,
        kept,
      });
    }
  }
  return narrowings;
}

/** How many rows of `table` hold a non-null `column` value outside `kept`. */
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
  return sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE ${col} IS NOT NULL AND ${col} NOT IN (${sql.join(
    kept.map(value => sql`${value}`),
    sql`, `
  )})`;
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

/** `rows` counted, as a refusal words it. */
function rowsHold(rows: number): string {
  return rows === 1 ? "1 row holds" : `${String(rows)} rows hold`;
}

/**
 * Refuses the apply, before any statement runs, when a check it narrows takes
 * a value away that a row still holds.
 *
 * Counted on the table as it stands now, under the name a rename in the same
 * apply is taking it from, so the rows the change would break are the rows
 * read.
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
    const [row] = await querySqlRows<{ n: number | string }>(
      args.db,
      args.dialect,
      rowsHolding(table, narrowing.liveColumn, narrowing.kept)
    );
    const count = Number(row?.n ?? 0);
    if (count === 0) continue;
    const { label, field, isEntity } = subjectOf(
      args.desired,
      narrowing.table,
      narrowing.column
    );
    const those = count === 1 ? "that row" : "those rows";
    const values = narrowing.values.map(value => `'${value}'`).join(", ");
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

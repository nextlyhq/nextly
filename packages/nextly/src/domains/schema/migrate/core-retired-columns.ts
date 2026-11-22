/**
 * What a core upgrade deletes, and how the push is kept from seeing it.
 *
 * A column a core table still has and this version no longer declares (nor a
 * hook contributed) is retired: `access_rules` on the two registry tables is
 * the first. drizzle-kit, handed the core tables without it, plans its drop,
 * and when the same table also gains a column it pairs the two as a possible
 * rename and crashes ("resolver(column) was called without a HintsHandler"),
 * or on MySQL and SQLite degrades to a pass that adds nothing. So the push is
 * handed each core table WITH its retired columns, as the live table has them:
 * nothing is dropped, nothing pairs, and every addition goes through. The drop
 * is then Nextly's own statement, run only once the consent covers it.
 *
 * The same consent (`--accept-data-loss`) covers the other core changes that
 * can lose values or fail on existing rows: a type that changes, a column that
 * becomes required. Each is a deletion in its column.
 *
 * @module domains/schema/migrate/core-retired-columns
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { getTableName, isTable, sql } from "drizzle-orm";
import {
  customType as mysqlCustomType,
  mysqlTable,
} from "drizzle-orm/mysql-core";
import { customType as pgCustomType, pgTable } from "drizzle-orm/pg-core";
import {
  customType as sqliteCustomType,
  sqliteTable,
} from "drizzle-orm/sqlite-core";

import { reasonFor } from "../pipeline/classifier/modes";
import type {
  ColumnSpec,
  NextlySchemaSnapshot,
  Operation,
} from "../pipeline/diff/types";

import type { Deletion } from "./data-loss-consent";

/**
 * The release to upgrade with first when this one cannot bring a database's
 * core tables up to date in one step: the last release that still declared
 * `access_rules`, whose reconcile adds the newer core columns without pairing
 * them against that drop. Moved forward whenever a core column is retired.
 */
export const CORE_UPGRADE_STEPPING_STONE = "0.0.2-alpha.65";

/** Why a known retired core column goes, as the listing says it. */
const KNOWN_RETIRED_COLUMNS: ReadonlyMap<string, string> = new Map([
  [
    "dynamic_collections.access_rules",
    "the collections' stored access rules, no longer enforced since 0.0.2-alpha.66",
  ],
  [
    "dynamic_singles.access_rules",
    "the Singles' stored access rules, no longer enforced since 0.0.2-alpha.66",
  ],
]);

/** Why any other undeclared core column or table goes. */
const NOT_DECLARED = "not declared by this version of Nextly";

/** A live core column this version does not declare, as the database has it. */
export interface RetiredCoreColumn {
  table: string;
  column: ColumnSpec;
}

/**
 * The retired columns among `ops`: each `drop_column` the core diff plans,
 * with the column as `live` has it, so the push can be handed it unchanged.
 */
export function retiredCoreColumns(
  ops: readonly Operation[],
  live: NextlySchemaSnapshot
): RetiredCoreColumn[] {
  const out: RetiredCoreColumn[] = [];
  for (const op of ops) {
    if (op.type !== "drop_column") continue;
    const column = live.tables
      .find(table => table.name === op.tableName)
      ?.columns.find(candidate => candidate.name === op.columnName);
    if (column !== undefined) out.push({ table: op.tableName, column });
  }
  return out;
}

/**
 * What a destructive core change deletes, as the shared consent judges it.
 *
 * Only ever asked of an operation `isDestructive` selected: which changes are
 * destructive is that function's one answer, and this only names each as a
 * deletion. A retired column or table, a type change, a column made required
 * or added as required are named by their column or table; anything else it
 * selects, now or later, is a deletion it cannot name (`unnamed`), which only
 * the consent without targets covers. Every one is marked `core`, so only the
 * consent itself, or the deprecated `NEXTLY_ALLOW_CORE_DESTRUCTIVE`, covers it.
 */
export function coreDeletionOf(op: Operation): Deletion {
  switch (op.type) {
    case "drop_column":
      return {
        kind: "column",
        table: op.tableName,
        column: op.columnName,
        core: true,
        reason:
          KNOWN_RETIRED_COLUMNS.get(`${op.tableName}.${op.columnName}`) ??
          NOT_DECLARED,
      };
    case "drop_table":
      return {
        kind: "table",
        table: op.tableName,
        core: true,
        reason: NOT_DECLARED,
      };
    case "change_column_type":
      return {
        kind: "column",
        table: op.tableName,
        column: op.columnName,
        core: true,
        reason: `type changes from ${op.fromType} to ${op.toType}`,
      };
    case "change_column_nullable":
      return {
        kind: "column",
        table: op.tableName,
        column: op.columnName,
        core: true,
        reason: "becomes required, which fails on a row without a value",
      };
    case "add_column":
      return {
        kind: "column",
        table: op.tableName,
        column: op.column.name,
        core: true,
        reason:
          "added as required with no default, which fails on existing rows",
      };
    default:
      return {
        kind: "unnamed",
        core: true,
        description: reasonFor(op),
        fingerprint: `${op.type}:${JSON.stringify(op)}`,
      };
  }
}

/** Whether `op` is a drop the push never makes and Nextly makes itself. */
export function isCoreDrop(
  op: Operation
): op is Extract<Operation, { type: "drop_column" | "drop_table" }> {
  return op.type === "drop_column" || op.type === "drop_table";
}

const COLUMNS = Symbol.for("drizzle:Columns");

/**
 * The push bundle with each retired column put back on its table, as the live
 * table has it (type, nullability, default), so drizzle-kit plans nothing
 * against it: no drop, no rename pairing, and on SQLite a rebuild that copies
 * it. The table is a copy of the core table with the column added; the core
 * definition itself is never changed.
 */
export function bundleCarryingRetiredColumns(
  bundle: Record<string, unknown>,
  retired: readonly RetiredCoreColumn[],
  dialect: SupportedDialect
): Record<string, unknown> {
  if (retired.length === 0) return bundle;
  const out: Record<string, unknown> = {};
  for (const [key, table] of Object.entries(bundle)) {
    if (!isTable(table)) {
      out[key] = table;
      continue;
    }
    const name = getTableName(table);
    const own = retired.filter(entry => entry.table === name);
    out[key] =
      own.length === 0 ? table : tableWithColumns(table, name, own, dialect);
  }
  return out;
}

/** A copy of `table` that also has `retired`'s columns. */
function tableWithColumns(
  table: object,
  name: string,
  retired: readonly RetiredCoreColumn[],
  dialect: SupportedDialect
): object {
  const added = carriedColumns(
    name,
    retired.map(entry => entry.column),
    dialect
  );
  const copy = Object.assign(
    Object.create(Object.getPrototypeOf(table) as object) as object,
    table,
    added
  ) as Record<string | symbol, unknown>;
  copy[COLUMNS] = {
    ...((table as Record<symbol, Record<string, unknown>>)[COLUMNS] ?? {}),
    ...added,
  };
  return copy;
}

/**
 * Drizzle columns for `columns`, built on a table of the same name with the
 * dialect's own table function, each typed exactly as the live database
 * reports it.
 */
function carriedColumns(
  table: string,
  columns: readonly ColumnSpec[],
  dialect: SupportedDialect
): Record<string, unknown> {
  const builders: Record<string, unknown> = {};
  for (const column of columns) {
    builders[column.name] = carriedBuilder(column, dialect);
  }
  const built = (dialect === "postgresql"
    ? pgTable(table, builders as never)
    : dialect === "mysql"
      ? mysqlTable(table, builders as never)
      : sqliteTable(table, builders as never)) as unknown as Record<
    symbol,
    Record<string, unknown>
  >;
  return { ...built[COLUMNS] };
}

/**
 * The type a live column was declared with. PostgreSQL's introspection keeps
 * the width apart (`varchar` with `typeModifier` 255); MySQL's and SQLite's
 * `type` already carries it. Handed drizzle-kit without its width, the column
 * would read as a type change of its own.
 */
function declaredType(column: ColumnSpec): string {
  return column.typeModifier !== undefined && !column.type.includes("(")
    ? `${column.type}(${column.typeModifier})`
    : column.type;
}

/** One live column as a drizzle column builder of its own type. */
function carriedBuilder(
  column: ColumnSpec,
  dialect: SupportedDialect
): unknown {
  const config = { dataType: () => declaredType(column) };
  type Builder = {
    notNull: () => Builder;
    default: (value: unknown) => Builder;
  };
  let builder = (dialect === "postgresql"
    ? pgCustomType(config)(column.name)
    : dialect === "mysql"
      ? mysqlCustomType(config)(column.name)
      : sqliteCustomType(config)(column.name)) as unknown as Builder;
  if (!column.nullable) builder = builder.notNull();
  if (column.default !== undefined) {
    builder = builder.default(sql.raw(column.default));
  }
  return builder;
}

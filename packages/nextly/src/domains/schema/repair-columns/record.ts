// The record of each column repair, and of a conversion's progress where it takes several commits.
//
// One row per column a run converts: the time, the table and column, the type and nullability
// before and after, the class, whether consent was given and how many values were cleared. On
// PostgreSQL and SQLite the row is written in the conversion's own transaction, so a column is
// converted with its record or not at all. MySQL commits each schema statement on its own, so there
// the row is written first, as the conversion's progress, and moved on after each committed step;
// a run that stops between two commits leaves the row naming a step, which the next `--apply` run
// checks against the live column before it finishes the conversion.
//
// The table is created by the first `--apply` run that converts a column, never by `nextly migrate`
// or an upgrade, so a site that never runs a repair has nothing new. A read of it treats a missing
// table as no record at all.
//
// @module domains/schema/repair-columns/record

import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import {
  boolean as mysqlBoolean,
  datetime,
  int,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  boolean as pgBoolean,
  integer as pgInteger,
  pgTable,
  text as pgText,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
} from "drizzle-orm/sqlite-core";

import { createTableIfAbsent } from "../../../database/concurrent-create";
import { nowExpression } from "../../../database/lease-clock";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import type { SupportedDialect } from "../services/field-column-descriptor";
import type { ConversionClass } from "../value-conversion/types";

import type { ColumnState } from "./types";

/** The table that holds each column repair. */
export const COLUMN_REPAIRS_TABLE = "nextly_column_repairs";

const pgColumnRepairs = pgTable(COLUMN_REPAIRS_TABLE, {
  id: pgText("id").primaryKey(),
  tableName: pgText("table_name").notNull(),
  columnName: pgText("column_name").notNull(),
  fromType: pgText("from_type").notNull(),
  fromNullable: pgBoolean("from_nullable").notNull(),
  toType: pgText("to_type").notNull(),
  toNullable: pgBoolean("to_nullable").notNull(),
  class: pgText("class").notNull(),
  consent: pgBoolean("consent").notNull(),
  valuesCleared: pgInteger("values_cleared").notNull(),
  state: pgText("state").notNull(),
  step: pgInteger("step").notNull(),
  steps: pgInteger("steps").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

const mysqlColumnRepairs = mysqlTable(COLUMN_REPAIRS_TABLE, {
  id: varchar("id", { length: 36 }).primaryKey(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  columnName: varchar("column_name", { length: 255 }).notNull(),
  fromType: varchar("from_type", { length: 255 }).notNull(),
  fromNullable: mysqlBoolean("from_nullable").notNull(),
  toType: varchar("to_type", { length: 255 }).notNull(),
  toNullable: mysqlBoolean("to_nullable").notNull(),
  class: varchar("class", { length: 16 }).notNull(),
  consent: mysqlBoolean("consent").notNull(),
  valuesCleared: int("values_cleared").notNull(),
  state: varchar("state", { length: 16 }).notNull(),
  step: int("step").notNull(),
  steps: int("steps").notNull(),
  startedAt: datetime("started_at").notNull(),
  endedAt: datetime("ended_at"),
});

// SQLite keeps times as unix seconds, as every other Nextly lease and lock table does.
const sqliteColumnRepairs = sqliteTable(COLUMN_REPAIRS_TABLE, {
  id: sqliteText("id").primaryKey(),
  tableName: sqliteText("table_name").notNull(),
  columnName: sqliteText("column_name").notNull(),
  fromType: sqliteText("from_type").notNull(),
  fromNullable: sqliteInteger("from_nullable", { mode: "boolean" }).notNull(),
  toType: sqliteText("to_type").notNull(),
  toNullable: sqliteInteger("to_nullable", { mode: "boolean" }).notNull(),
  class: sqliteText("class").notNull(),
  consent: sqliteInteger("consent", { mode: "boolean" }).notNull(),
  valuesCleared: sqliteInteger("values_cleared").notNull(),
  state: sqliteText("state").notNull(),
  step: sqliteInteger("step").notNull(),
  steps: sqliteInteger("steps").notNull(),
  startedAt: sqliteInteger("started_at", { mode: "timestamp" }).notNull(),
  endedAt: sqliteInteger("ended_at", { mode: "timestamp" }),
});

/** The declared columns of the dialect's table, as the DDL below names them. */
function declaredColumns(dialect: SupportedDialect) {
  const table =
    dialect === "postgresql"
      ? pgColumnRepairs
      : dialect === "mysql"
        ? mysqlColumnRepairs
        : sqliteColumnRepairs;
  return Object.values(getTableColumns(table));
}

/** DDL for the repairs table, built from its declaration so the two cannot disagree. */
export function getColumnRepairsDdl(dialect: SupportedDialect): string {
  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const columns = declaredColumns(dialect).map(column =>
    [
      quote(column.name),
      column.getSQLType(),
      column.primary ? "PRIMARY KEY" : column.notNull ? "NOT NULL" : "",
    ]
      .filter(part => part !== "")
      .join(" ")
  );
  return `CREATE TABLE IF NOT EXISTS ${quote(COLUMN_REPAIRS_TABLE)} (${columns.join(", ")})`;
}

/** Create the repairs table where it does not exist yet. Safe to run from several processes. */
export async function ensureColumnRepairsTable(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<void> {
  await createTableIfAbsent(
    adapter,
    dialect,
    COLUMN_REPAIRS_TABLE,
    getColumnRepairsDdl(dialect)
  );
}

/** Run one Drizzle statement for its effect, on a Drizzle instance of the dialect. */
async function runSql(
  db: unknown,
  dialect: SupportedDialect,
  statement: SQL
): Promise<void> {
  if (dialect === "sqlite") {
    (db as { run(q: SQL): unknown }).run(statement);
    return;
  }
  await (db as { execute(q: SQL): Promise<unknown> }).execute(statement);
}

/** Whether the repairs table exists, read without creating it. */
async function repairsTableExists(
  db: unknown,
  dialect: SupportedDialect
): Promise<boolean> {
  const rows = await querySqlRows<{ n: unknown }>(
    db,
    dialect,
    dialect === "sqlite"
      ? sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM sqlite_master WHERE type = 'table' AND name = ${COLUMN_REPAIRS_TABLE}`
      : dialect === "mysql"
        ? sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${COLUMN_REPAIRS_TABLE}`
        : sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${COLUMN_REPAIRS_TABLE}`
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** What a repair converts: the column, its state before and after, and the class it was judged. */
export interface RepairFacts {
  table: string;
  column: string;
  from: ColumnState;
  to: ColumnState;
  class: ConversionClass;
  consent: boolean;
  valuesCleared: number;
}

/** A repair whose conversion has not reached its last step: the step its record names. */
export interface RecordedProgress {
  id: string;
  table: string;
  column: string;
  from: ColumnState;
  to: ColumnState;
  class: ConversionClass;
  consent: boolean;
  valuesCleared: number;
  /** The steps the record says have committed, of `steps`. */
  step: number;
  steps: number;
}

/** A finished repair, as its record holds it. */
export interface RepairRow extends RepairFacts {
  id: string;
  state: "in-progress" | "converted";
  step: number;
  steps: number;
}

const id = (name: string) => sql.identifier(name);

/**
 * Write a repair's row: finished, where the conversion committed with it in one transaction, or in
 * progress at step 0 of `steps`, where its steps commit one by one. Returns the row's id.
 */
export async function insertRepair(
  db: unknown,
  dialect: SupportedDialect,
  facts: RepairFacts,
  progress: { state: "in-progress" | "converted"; step: number; steps: number }
): Promise<string> {
  const rowId = randomUUID();
  const now = nowExpression(dialect);
  const ended = progress.state === "converted" ? now : sql`NULL`;
  await runSql(
    db,
    dialect,
    sql`INSERT INTO ${id(COLUMN_REPAIRS_TABLE)} (${id("id")}, ${id("table_name")}, ${id("column_name")}, ${id("from_type")}, ${id("from_nullable")}, ${id("to_type")}, ${id("to_nullable")}, ${id("class")}, ${id("consent")}, ${id("values_cleared")}, ${id("state")}, ${id("step")}, ${id("steps")}, ${id("started_at")}, ${id("ended_at")})
      VALUES (${rowId}, ${facts.table}, ${facts.column}, ${typeText(facts.from)}, ${flag(facts.from.nullable, dialect)}, ${typeText(facts.to)}, ${flag(facts.to.nullable, dialect)}, ${facts.class}, ${flag(facts.consent, dialect)}, ${facts.valuesCleared}, ${progress.state}, ${progress.step}, ${progress.steps}, ${now}, ${ended})`
  );
  return rowId;
}

/**
 * A type as the record keeps it: with the size PostgreSQL reports beside it (`numeric` and
 * `10,2` as `numeric(10,2)`), so the record says exactly what was converted.
 */
function typeText(state: ColumnState): string {
  return state.typeModifier === undefined
    ? state.type
    : `${state.type}(${state.typeModifier})`;
}

/** A boolean as the dialect's declared column takes it. */
function flag(value: boolean, dialect: SupportedDialect): boolean | number {
  return dialect === "postgresql" ? value : value ? 1 : 0;
}

/** Move an in-progress row to `step`, or finish it once `step` is its last. */
export async function recordStep(
  db: unknown,
  dialect: SupportedDialect,
  rowId: string,
  step: number,
  steps: number
): Promise<void> {
  const finished = step >= steps;
  await runSql(
    db,
    dialect,
    sql`UPDATE ${id(COLUMN_REPAIRS_TABLE)} SET ${id("step")} = ${step}, ${id("state")} = ${finished ? "converted" : "in-progress"}, ${id("ended_at")} = ${finished ? nowExpression(dialect) : sql`NULL`} WHERE ${id("id")} = ${rowId}`
  );
}

interface RawRow {
  id: unknown;
  table_name: unknown;
  column_name: unknown;
  from_type: unknown;
  from_nullable: unknown;
  to_type: unknown;
  to_nullable: unknown;
  class: unknown;
  consent: unknown;
  values_cleared: unknown;
  state: unknown;
  step: unknown;
  steps: unknown;
}

/** A flag as any driver hands it back: a boolean, a number, or a numeric string. */
function asFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

function rowOf(raw: RawRow): RepairRow {
  return {
    id: String(raw.id),
    table: String(raw.table_name),
    column: String(raw.column_name),
    from: { type: String(raw.from_type), nullable: asFlag(raw.from_nullable) },
    to: { type: String(raw.to_type), nullable: asFlag(raw.to_nullable) },
    class: String(raw.class) as ConversionClass,
    consent: asFlag(raw.consent),
    valuesCleared: Number(raw.values_cleared),
    state: raw.state === "converted" ? "converted" : "in-progress",
    step: Number(raw.step),
    steps: Number(raw.steps),
  };
}

/** Every repair row, oldest first; none where no run has made the table. Changes nothing. */
export async function readRepairs(
  db: unknown,
  dialect: SupportedDialect
): Promise<RepairRow[]> {
  if (!(await repairsTableExists(db, dialect))) return [];
  const rows = await querySqlRows<RawRow>(
    db,
    dialect,
    sql`SELECT ${id("id")}, ${id("table_name")}, ${id("column_name")}, ${id("from_type")}, ${id("from_nullable")}, ${id("to_type")}, ${id("to_nullable")}, ${id("class")}, ${id("consent")}, ${id("values_cleared")}, ${id("state")}, ${id("step")}, ${id("steps")} FROM ${id(COLUMN_REPAIRS_TABLE)} ORDER BY ${id("started_at")}, ${id("id")}`
  );
  return rows.map(rowOf);
}

/**
 * The repairs whose conversion has not reached its last step. Changes nothing.
 *
 * Only MySQL can hold one: on PostgreSQL and SQLite a conversion commits with its record in one
 * transaction, so no row is ever left in progress there, and the table is not read at all. That
 * also keeps a dry run on a SQLite database another connection holds to the one read it reports.
 */
export async function readUnfinishedRepairs(
  db: unknown,
  dialect: SupportedDialect
): Promise<RecordedProgress[]> {
  if (dialect !== "mysql") return [];
  if (!(await repairsTableExists(db, dialect))) return [];
  // Only the unfinished rows are read: the table keeps every repair ever made.
  const rows = await querySqlRows<RawRow>(
    db,
    dialect,
    sql`SELECT ${id("id")}, ${id("table_name")}, ${id("column_name")}, ${id("from_type")}, ${id("from_nullable")}, ${id("to_type")}, ${id("to_nullable")}, ${id("class")}, ${id("consent")}, ${id("values_cleared")}, ${id("state")}, ${id("step")}, ${id("steps")} FROM ${id(COLUMN_REPAIRS_TABLE)} WHERE ${id("state")} = ${"in-progress"} ORDER BY ${id("started_at")}, ${id("id")}`
  );
  return rows.map(rowOf);
}

/**
 * Remove a progress row whose conversion committed nothing: the column is exactly as it was, so
 * nothing is left to finish and nothing was repaired.
 */
export async function deleteRepair(
  db: unknown,
  dialect: SupportedDialect,
  rowId: string
): Promise<void> {
  await runSql(
    db,
    dialect,
    sql`DELETE FROM ${id(COLUMN_REPAIRS_TABLE)} WHERE ${id("id")} = ${rowId}`
  );
}

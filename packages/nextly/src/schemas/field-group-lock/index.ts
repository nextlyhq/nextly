/**
 * `nextly_schema_lock` and `nextly_field_group_lock` — dialect-aware barrel.
 *
 * The schema lock is the one every schema change takes; the field-group lock is the earlier lock it
 * is held beside, for processes of an earlier Nextly version (`domains/schema/pipeline/schema-lock`).
 *
 * @module schemas/field-group-lock
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";

import { loadedDialect } from "../../database/dialect-tables";
import { NextlyError } from "../../errors/nextly-error";

/** A column the lock table is made of. */
export type FieldGroupLockColumn = "id" | "owner" | "expires_at";

/**
 * The physical type each lock column is declared with, read out of the declaration itself.
 *
 * The bootstrap DDL has to name a type per column, and the declarations above already carry one.
 * Restating them there would be a second answer to the same question, drifting silently: the
 * bootstrap would keep creating the old shape while a reconcile proposed the new one on every run.
 * Reading `getSQLType()` makes the declaration the only place a type is chosen.
 *
 * Read through each dialect's own `getTableConfig` rather than the table object's own accessor,
 * which the drizzle-v1 gate bars, following the prior art in the declaration-parity test.
 */
export function fieldGroupLockColumnTypes(
  dialect: SupportedDialect
): Record<FieldGroupLockColumn, string> {
  const read = declaredTypeReader(
    dialect,
    "field-group",
    lockForDialect(dialect).columns
  );
  return {
    id: read("id"),
    owner: read("owner"),
    expires_at: read("expires_at"),
  };
}

/** A column the schema lock table is made of. */
export type SchemaLockColumn =
  | "id"
  | "owner"
  | "command"
  | "acquired_at"
  | "expires_at";

/**
 * The physical type each schema lock column is declared with, read out of the declaration for the
 * reason {@link fieldGroupLockColumnTypes} gives: the bootstrap and a reconcile describe one table.
 */
export function schemaLockColumnTypes(
  dialect: SupportedDialect
): Record<SchemaLockColumn, string> {
  const read = declaredTypeReader(
    dialect,
    "schema",
    schemaLockForDialect(dialect).columns
  );
  return {
    id: read("id"),
    owner: read("owner"),
    command: read("command"),
    acquired_at: read("acquired_at"),
    expires_at: read("expires_at"),
  };
}

/** A declared column as both readers see it. */
interface DeclaredColumn {
  readonly name: string;
  getSQLType(): string;
}

/** Reads one declared column's type, refusing a column the declaration lost. */
function declaredTypeReader(
  dialect: SupportedDialect,
  lock: "field-group" | "schema",
  columns: readonly DeclaredColumn[]
): (name: string) => string {
  const declared = new Map(
    columns.map(column => [column.name, column.getSQLType()])
  );
  return name => {
    const type = declared.get(name);
    if (type === undefined) {
      // The declaration lost a column the bootstrap needs. `internal` because only a code change
      // can produce it, and failing here beats emitting a CREATE with a hole in it.
      throw NextlyError.internal({
        logContext: {
          reason: `${lock} lock declaration is missing a column`,
          dialect,
          column: name,
        },
      });
    }
    return type;
  };
}

/**
 * The ONE place a dialect is turned into a lock table, with the columns that table declares.
 *
 * 🔴 Both public functions below are views of this, rather than two selections that happen to
 * agree. A second selection does not need to be wrong to be dangerous: written as a ternary chain
 * ending in a bare `else`, it silently ASSIGNS every future dialect to whichever branch is last, so
 * adding one to `SupportedDialect` would compile and emit another dialect's column types. Here the
 * switch is over the loaded dialect, so the compiler demands a case for each one it can be, and
 * `loadedDialect` refuses a dialect it does not know before any case is reached.
 *
 * The table is the loaded dialect's own, so only that dialect's files are imported.
 */
function lockForDialect(dialect: SupportedDialect) {
  const loaded = loadedDialect(dialect);
  switch (loaded.dialect) {
    case "postgresql": {
      const table = loaded.tables.nextlyFieldGroupLock;
      return { table, columns: pgTableConfig(table).columns };
    }
    case "mysql": {
      const table = loaded.tables.nextlyFieldGroupLock;
      return { table, columns: mysqlTableConfig(table).columns };
    }
    case "sqlite": {
      const table = loaded.tables.nextlyFieldGroupLock;
      return { table, columns: sqliteTableConfig(table).columns };
    }
  }
}

/** The lock table for the requested dialect, as a schema fragment. */
export function fieldGroupLockTables(dialect: SupportedDialect) {
  return { nextlyFieldGroupLock: lockForDialect(dialect).table };
}

/** The schema lock table, chosen the way {@link lockForDialect} chooses the field-group one. */
function schemaLockForDialect(dialect: SupportedDialect) {
  const loaded = loadedDialect(dialect);
  switch (loaded.dialect) {
    case "postgresql": {
      const table = loaded.tables.nextlySchemaLock;
      return { table, columns: pgTableConfig(table).columns };
    }
    case "mysql": {
      const table = loaded.tables.nextlySchemaLock;
      return { table, columns: mysqlTableConfig(table).columns };
    }
    case "sqlite": {
      const table = loaded.tables.nextlySchemaLock;
      return { table, columns: sqliteTableConfig(table).columns };
    }
  }
}

/** The schema lock table for the requested dialect, as a schema fragment. */
export function schemaLockTables(dialect: SupportedDialect) {
  return { nextlySchemaLock: schemaLockForDialect(dialect).table };
}

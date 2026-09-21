/**
 * The app's per-dialect escape hatch, and the check that makes it safe.
 *
 * The neutral model is deliberately narrow, and an app occasionally needs
 * something outside it — a `bigint`, a `char(3)`, a column type only one
 * dialect has. Payload allows that and LOSES what its codegen cannot express,
 * silently. The difference here is that anything the model cannot carry is
 * REFUSED at boot, naming the table and the construct, because a constraint
 * missing from migrations and drift is a constraint that exists on the
 * developer's machine and nowhere else.
 *
 * App only, never plugins. A per-dialect escape hatch is the app's decision
 * about its own database, the same way auth strategies are; a plugin reaching
 * for one would be making that decision for every install of it.
 *
 * @module domains/schema/extension/after-drizzle
 * @since 1.0.0
 */
import { getColumns, getTableName, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import type { SchemaOwner } from "./types";

export type DrizzleSchemaHook = (args: {
  dialect: SupportedDialect;
  /** Extension tables compiled for this dialect, keyed by SQL name. */
  tables: Record<string, unknown>;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

/** What the table config exposes that the neutral model cannot carry. */
interface TableConfigShape {
  indexes?: unknown[];
  checks?: unknown[];
  foreignKeys?: unknown[];
  uniqueConstraints?: unknown[];
  primaryKeys?: unknown[];
}

function refuse(table: string, construct: string, remedy: string): never {
  throw NextlyError.validation({
    errors: [
      {
        path: `db.schema.afterDrizzle.${table}`,
        code: "INVALID",
        message: `Table "${table}" declares ${construct}, which Nextly's schema model cannot carry into migrations or drift detection. ${remedy}`,
      },
    ],
  });
}

/** The table's config, read with the accessor for its dialect. */
function readConfig(
  table: Table,
  dialect: SupportedDialect
): TableConfigShape | null {
  try {
    switch (dialect) {
      case "postgresql":
        return pgTableConfig(table as never);
      case "mysql":
        return mysqlTableConfig(table);
      case "sqlite":
        return sqliteTableConfig(table as never);
    }
  } catch {
    // A handle the accessor cannot read is UNKNOWN, not empty — and an
    // unknown table is exactly the one that must not be waved through.
    return null;
  }
}

/**
 * Whether an index is one the converter would silently drop.
 *
 * Two shapes matter and they look different. A PARTIAL index carries a
 * `where`, which the converter discards — so the index reaches the database
 * covering fewer rows than the spec claims. An EXPRESSION index converts with
 * `columns: []`, so a count comparison finds the right NUMBER of indexes and
 * the wrong ones.
 */
function unconvertibleIndex(
  entry: unknown
): { reason: string; remedy: string } | null {
  if (typeof entry !== "object" || entry === null) return null;
  const config = (entry as { config?: unknown }).config;
  if (typeof config !== "object" || config === null) return null;
  const { where, columns } = config as { where?: unknown; columns?: unknown };

  if (where !== undefined && where !== null) {
    return {
      reason: "a partial index",
      remedy: "Partial indexes arrive in a later release.",
    };
  }
  // An index whose columns do not resolve to names is an expression index.
  const named =
    Array.isArray(columns) &&
    columns.every(
      column =>
        typeof column === "object" &&
        column !== null &&
        typeof (column as { name?: unknown }).name === "string"
    );
  if (!named) {
    return {
      reason: "an expression index",
      remedy: "Index a column instead.",
    };
  }
  return null;
}

/** Column-level constructs the model cannot express. */
function assertColumnsConvertible(table: Table, name: string): void {
  for (const column of Object.values(getColumns(table))) {
    const shape = column as unknown as {
      isUnique?: unknown;
      generated?: unknown;
      generatedIdentity?: unknown;
      enumValues?: unknown;
    };
    if (shape.isUnique === true) {
      refuse(
        name,
        "a column-level unique constraint",
        "Declare a unique index instead, which the diff engine can reconcile."
      );
    }
    if (shape.generated !== undefined && shape.generated !== null) {
      refuse(name, "a generated column", "Compute the value on write.");
    }
    if (
      shape.generatedIdentity !== undefined &&
      shape.generatedIdentity !== null
    ) {
      refuse(name, "an identity column", "Use a generated id instead.");
    }
    if (Array.isArray(shape.enumValues) && shape.enumValues.length > 0) {
      // A native enum's introspected type is the enum NAME, so the desired
      // and live sides would never agree on the column's type.
      refuse(
        name,
        "an enum column",
        "Use a text column and validate the values."
      );
    }
  }
}

/**
 * Table-level constructs the model cannot express, as data.
 *
 * A table because the list IS the specification: each row reads as the
 * construct it refuses and the remedy it offers, and adding one is a line
 * rather than another branch in a function that already had a dozen.
 */
const UNCONVERTIBLE_TABLE_PARTS: ReadonlyArray<{
  read: (config: TableConfigShape) => unknown[];
  construct: string;
  remedy: string;
}> = [
  {
    read: config => config.checks ?? [],
    construct: "a check constraint",
    remedy: "Validate the value before writing it.",
  },
  {
    read: config => config.foreignKeys ?? [],
    construct: "a foreign key",
    remedy: "References are recorded but not constrained in this release.",
  },
  {
    read: config => config.uniqueConstraints ?? [],
    construct: "a table-level unique constraint",
    remedy:
      "Declare a unique index instead, which the diff engine can reconcile.",
  },
  {
    read: config => config.primaryKeys ?? [],
    construct: "a composite primary key",
    remedy: "Use a single generated id and a unique index over the columns.",
  },
];

/** Table-level constructs the model cannot express. */
function assertTableConvertible(
  table: Table,
  name: string,
  dialect: SupportedDialect
): void {
  const config = readConfig(table, dialect);
  if (config === null) {
    refuse(
      name,
      "a shape Nextly could not read",
      "Build it with the dialect's own table helper."
    );
  }

  for (const entry of config.indexes ?? []) {
    const problem = unconvertibleIndex(entry);
    if (problem) refuse(name, problem.reason, problem.remedy);
  }
  for (const part of UNCONVERTIBLE_TABLE_PARTS) {
    if (part.read(config).length > 0) {
      refuse(name, part.construct, part.remedy);
    }
  }
}

/**
 * Run the app's hooks and check what they returned.
 *
 * A table the hook did not produce is left exactly as compiled, so a hook that
 * returns its input unchanged changes nothing.
 */
export async function runAfterDrizzle(args: {
  dialect: SupportedDialect;
  tables: Record<string, unknown>;
  hooks: readonly DrizzleSchemaHook[];
  owners: ReadonlyMap<string, SchemaOwner>;
  /** Core and entity table names, which a hook may not touch. */
  protectedTables: ReadonlySet<string>;
}): Promise<Record<string, unknown>> {
  if (args.hooks.length === 0) return args.tables;

  let tables = { ...args.tables };
  for (const hook of args.hooks) {
    tables = await hook({ dialect: args.dialect, tables: { ...tables } });
  }

  for (const [name, value] of Object.entries(tables)) {
    if (args.protectedTables.has(name)) {
      refuse(
        name,
        "a change to a core or entity table",
        "Those are maintained by Nextly; use contributes.extend for entity fields."
      );
    }
    const owner = args.owners.get(name);
    // A plugin's table is its own to describe. An app reshaping it would make
    // the plugin's migrations disagree with the table they are meant to own.
    if (owner?.kind === "plugin") {
      refuse(
        name,
        `a change to a table owned by plugin "${owner.id}"`,
        "An app may only shape its own tables here."
      );
    }
    assertColumnsConvertible(value as Table, name);
    assertTableConvertible(value as Table, name, args.dialect);
    if (getTableName(value as Table) !== name) {
      refuse(
        name,
        `a table whose SQL name is "${getTableName(value as Table)}"`,
        "The key and the table name must match."
      );
    }
  }

  return tables;
}

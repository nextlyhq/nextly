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

import type {
  DynamicRelationEdge,
  SupportedDialect,
} from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { drizzleTableToTableSpec } from "../../../schemas/_internal/drizzle-to-tablespec";
import { scanSql } from "../migrate/sql-scan";
import type { ColumnSpec, IndexSpec, TableSpec } from "../pipeline/diff/types";

import { enumChecks } from "./enum-check";
import { assertUsableAppTableName } from "./naming";
import type { ExtensionTable, SchemaOwner } from "./types";

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
  /**
   * Core, entity and adopted table names, which a hook may not touch: the
   * first two Nextly maintains, and an adopted one nothing here maintains.
   */
  protectedTables: ReadonlySet<string>;
  /**
   * What a table the hook INTRODUCES is judged against: the same rule an app
   * table declared through `db.schema.extend` meets, so the escape hatch is
   * not a way around it.
   */
  naming: {
    coreTableNames: readonly string[];
    pluginPrefixes: readonly string[];
  };
}): Promise<Record<string, unknown>> {
  if (args.hooks.length === 0) return args.tables;

  // MERGED over what was compiled, never REPLACING it.
  //
  // The contract above — "a table the hook did not produce is left exactly as
  // compiled" — was the documented intent, but the assignment replaced the
  // whole map, so a hook returning only the table it cared about silently
  // dropped every other one. That table then vanished from the runtime Drizzle
  // registry while every installation still had it, and the caller's migration
  // model, built from the compiled tables, disagreed with what ran.
  let tables = { ...args.tables };
  for (const hook of args.hooks) {
    const returned = await hook({
      dialect: args.dialect,
      tables: { ...tables },
    });
    tables = { ...tables, ...returned };
  }

  // Only what the hook actually CHANGED is judged.
  //
  // With the merge above, the map holds every compiled table, not just the
  // returned ones — so validating all of them refused a plugin's table that
  // the hook had never seen, and an app using any `afterDrizzle` hook could
  // not boot alongside any plugin that declares a table.
  //
  // Identity is the test: a table the hook left alone is the very object that
  // was compiled, and it was validated when it was built. A table the hook
  // returned is a different object, whether it reshaped one or invented it,
  // and that is exactly the set these rules exist for.
  for (const [name, value] of Object.entries(tables)) {
    if (value === args.tables[name]) continue;
    if (args.protectedTables.has(name)) {
      refuse(
        name,
        "a change to a core, entity or adopted table",
        "Nextly maintains core and entity tables (use contributes.extend for entity fields), and an adopted table is never migrated at all."
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
    // A name no compile produced, and that no rule above claims, is a table
    // the hook introduced. It is the app's, so it answers to the app's naming
    // rule: a managed prefix
    // (`dc_`, `single_`, `comp_`, `nextly_`) would be reconciled — and
    // dropped — by the pipeline that owns it, a `_locales` suffix by the
    // localization layer, and a plugin's namespace by that plugin.
    if (!(name in args.tables)) {
      assertUsableAppTableName(
        name,
        args.naming.coreTableNames,
        args.naming.pluginPrefixes
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

/** Two derived columns describe the same column in every compared respect. */
function sameColumn(a: ColumnSpec, b: ColumnSpec): boolean {
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    a.default === b.default &&
    (a.primaryKey === true) === (b.primaryKey === true)
  );
}

/** Two indexes with the same name, columns and uniqueness. */
function sameIndex(a: IndexSpec, b: IndexSpec): boolean {
  return (
    a.name === b.name &&
    a.unique === b.unique &&
    a.columns.length === b.columns.length &&
    a.columns.every((column, i) => column === b.columns[i])
  );
}

/**
 * The migration spec of a compiled table after a hook reshaped it.
 *
 * Starts from the COMPILED spec and applies only what the hook changed.
 * Re-deriving the whole spec from the hook's Drizzle table loses everything a
 * Drizzle table does not carry: `toDrizzleTable` leaves checks, foreign keys
 * and the enum checks off on PostgreSQL and MySQL (they are separate
 * statements), `autoIncrement` is spec-only, and a hook that rebuilt a table
 * to widen one column rarely restates its indexes. Each of those read as "the
 * table has none", so the next push or generated migration dropped them — and
 * a MySQL serial key lost AUTO_INCREMENT, failing every insert that omits it.
 *
 * What the hook changed is found by comparing like with like: the hook's
 * Drizzle table against the COMPILED Drizzle table, both through the same
 * converter. A column that converts identically is one the hook restated, and
 * keeps its compiled spec; a column that converts differently, or is new, takes
 * the hook's. A column the hook left out is gone, and so are the enum check,
 * foreign keys and indexes that named it. An index the hook declares that the
 * compiled table did not is added; a declared index is otherwise kept, since a
 * rebuilt table that omits one says nothing about wanting it dropped.
 */
export function specAfterHook(args: {
  compiledSpec: TableSpec;
  compiledTable: Table;
  hookTable: Table;
  /** The declaration, for the enum checks a dropped column takes with it. */
  declared: ExtensionTable | undefined;
  dialect: SupportedDialect;
}): TableSpec {
  const before = drizzleTableToTableSpec(args.compiledTable, args.dialect);
  const after = drizzleTableToTableSpec(args.hookTable, args.dialect);

  const compiledColumns = new Map(
    args.compiledSpec.columns.map(column => [column.name, column])
  );
  const beforeColumns = new Map(
    before.columns.map(column => [column.name, column])
  );
  const columns = after.columns.map(column => {
    const restated = beforeColumns.get(column.name);
    const compiled = compiledColumns.get(column.name);
    return restated !== undefined &&
      compiled !== undefined &&
      sameColumn(restated, column)
      ? compiled
      : column;
  });
  const present = new Set(columns.map(column => column.name));
  const covers = (names: readonly string[]): boolean =>
    names.every(name => present.has(name));
  // The columns the hook took away. An index on one goes with it, as the
  // database takes it: by its columns, or — for an expression index, whose
  // `columns` are empty — by the names its expression reads.
  const removed = args.compiledSpec.columns
    .map(column => column.name)
    .filter(name => !present.has(name));
  const survives = (index: IndexSpec): boolean => {
    if (index.expression === undefined) return covers(index.columns);
    const named = checkIdentifiers(index.expression, args.dialect);
    return !removed.some(name => named.has(name.toLowerCase()));
  };

  const added = (after.indexes ?? []).filter(
    index =>
      covers(index.columns) &&
      !(before.indexes ?? []).some(known => sameIndex(known, index))
  );
  const addedNames = new Set(added.map(index => index.name));
  const indexes = [
    ...(args.compiledSpec.indexes ?? []).filter(
      index => !addedNames.has(index.name) && survives(index)
    ),
    ...added,
  ];

  const droppedEnumChecks = new Set(
    enumChecks(
      args.compiledSpec.name,
      (args.declared?.columns ?? []).filter(
        column => !present.has(column.name)
      ),
      args.dialect
    ).map(check => check.name)
  );

  const keptChecks = (args.compiledSpec.checks ?? []).filter(
    check => !droppedEnumChecks.has(check.name)
  );
  // A declared check is kept whatever the hook did — its SQL is the author's,
  // not something derived from a column — so one that names a column the
  // hook removed would reach the DDL naming a column that no longer exists,
  // and fail when the migration applies. Refused here instead, while the
  // config can still be fixed.
  for (const check of keptChecks) {
    const named = checkIdentifiers(check.sql, args.dialect);
    const gone = removed.find(name => named.has(name.toLowerCase()));
    if (gone !== undefined) {
      throw NextlyError.validation({
        errors: [
          {
            path: `db.schema.afterDrizzle.${args.compiledSpec.name}`,
            code: "INVALID",
            message: `The hook removed column "${gone}" from "${args.compiledSpec.name}", which the check "${check.name}" declared on that table still names. Keep the column, or remove the check from the table's declaration.`,
          },
        ],
      });
    }
  }

  return {
    ...args.compiledSpec,
    columns,
    indexes,
    ...(args.compiledSpec.foreignKeys !== undefined
      ? {
          foreignKeys: args.compiledSpec.foreignKeys.filter(fk =>
            covers(fk.columns)
          ),
        }
      : {}),
    ...(args.compiledSpec.checks !== undefined ? { checks: keptChecks } : {}),
  };
}

/**
 * The identifiers a check's or an index expression's SQL names, lowercased.
 *
 * Read through the shared SQL scanner, so text inside a string literal or a
 * comment is not mistaken for a column and a quoted name is read whole. Every
 * word of the code is taken, keywords and function names included: one that
 * happens to equal a removed column's name only makes the check refusal
 * conservative, and drops an index the column's removal would have left
 * unusable anyway only when the two share a name.
 */
function checkIdentifiers(sql: string, dialect: SupportedDialect): Set<string> {
  const names = new Set<string>();
  for (const segment of scanSql(sql, dialect)) {
    if (segment.kind === "quoted-name") {
      names.add(segment.content.toLowerCase());
    } else if (segment.kind === "code") {
      for (const word of sql
        .slice(segment.start, segment.end)
        .match(/[A-Za-z_][\w$]*/g) ?? []) {
        names.add(word.toLowerCase());
      }
    }
  }
  return names;
}

/**
 * The relation edges, re-keyed to the tables the hooks actually returned.
 *
 * An edge names its columns by the PROPERTY key of the table it is resolved
 * against, and the edges were built from the compiled tables. A hook that
 * rebuilt a table is free to key its columns differently — by SQL name, most
 * often — and the registry resolves every edge against the table that runs,
 * so one edge naming a key that table lacks failed `defineRelations` and took
 * `db.query` down for the whole schema. Each key is carried across by the SQL
 * column it names; a column the hook removed leaves an edge that cannot
 * resolve, which is refused here, naming it, rather than at the registry.
 */
export function rekeyRelationEdges(args: {
  edges: Map<string, DynamicRelationEdge[]>;
  compiled: Record<string, unknown>;
  returned: Record<string, unknown>;
}): void {
  const reshaped = (table: string): boolean =>
    table in args.compiled && args.returned[table] !== args.compiled[table];
  const carry = (table: string, key: string, path: string): string => {
    if (!reshaped(table)) return key;
    const sqlName = getColumns(args.compiled[table] as Table)[key]?.name;
    const entry = Object.entries(
      getColumns(args.returned[table] as Table)
    ).find(([, column]) => column.name === sqlName);
    if (sqlName === undefined || entry === undefined) {
      refuse(
        table,
        `no column "${sqlName ?? key}", which the relation ${path} joins on`,
        "Keep the column, or remove the relation that uses it."
      );
    }
    return entry[0];
  };

  for (const [table, list] of args.edges) {
    args.edges.set(
      table,
      list.map(edge => ({
        ...edge,
        fromColumn: carry(table, edge.fromColumn, `${table}.${edge.key}`),
        ...(edge.toColumn !== undefined
          ? {
              toColumn: carry(
                edge.targetTable,
                edge.toColumn,
                `${table}.${edge.key}`
              ),
            }
          : {}),
      }))
    );
  }
}

// SQLite / MySQL additive DDL emitter. Converts the purely-additive subset
// of pipeline Operation objects (add_table / add_column / add_index /
// drop_index) into SQL strings, so those applies never reach drizzle-kit's
// pushSchema on these dialects.
//
// Why this matters beyond speed: drizzle-kit v1 has NO introspection filter
// on SQLite/MySQL (only PG accepts an entities filter), so its differ sees
// the WHOLE live database. Any live table absent from the desired schema —
// UI-created entities during a code-first apply, localized `_locales`
// companion tables (excluded from the pipeline by design), the i18n archive —
// reads as "deleted". The moment the same apply also carries a "created"
// table, the differ consults its rename resolver to pair the two, and in a
// non-interactive run that throws `Internal error: resolver(table) was
// called without a HintsHandler`, failing the whole apply and leaving the
// new table uncreated. Emitting the additive DDL ourselves removes the
// "created" side of that pairing entirely.
//
// Contract mirrors the PostgreSQL emitter: only called for ops that
// canEmitWithoutDrizzleKit() green-lit (or the pipeline's explicit
// add_table pre-creation). rename_table / rename_column / drop_column /
// drop_table are executed by executePreResolutionOps BEFORE this runs, so
// they emit nothing here. change_* ops are NOT supported on these dialects
// (SQLite needs a table rebuild, MySQL needs a full MODIFY definition) and
// route the apply to drizzle-kit.

import { NextlyError } from "../../../../errors";
import { isPreResolutionOp } from "../diff/types";
import type { IndexSpec, Operation, TableSpec } from "../diff/types";

import { quoteIdent, quoteIdentMysql } from "./identifiers";

export type AdditiveDialect = "sqlite" | "mysql";

function quote(identifier: string, dialect: AdditiveDialect): string {
  return dialect === "mysql"
    ? quoteIdentMysql(identifier)
    : quoteIdent(identifier);
}

// Render a single CREATE [UNIQUE] INDEX statement. SQLite supports
// IF NOT EXISTS on CREATE INDEX; MySQL 8 does not, so it emits the plain
// form — the diff only plans add_index when the live table lacks it, so a
// duplicate-name failure means the diff and the DB genuinely disagree and
// should surface loudly.
function createIndexStatement(
  tableName: string,
  index: IndexSpec,
  dialect: AdditiveDialect
): string {
  const cols = index.columns.map(c => quote(c, dialect)).join(", ");
  const ifNotExists = dialect === "sqlite" ? "IF NOT EXISTS " : "";
  return (
    `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${ifNotExists}` +
    `${quote(index.name, dialect)} ON ${quote(tableName, dialect)} (${cols})`
  );
}

// Render the column tail shared by ADD COLUMN and CREATE TABLE column
// lists: `<type> [NOT NULL] [DEFAULT <expr>]`. `type` and `default` are
// dialect-ready tokens produced by diff/build-from-fields.ts (SQLite and
// MySQL both accept them verbatim — `text`, `integer`, `varchar(255)`,
// `'draft'`, `0`).
function columnTail(col: {
  type: string;
  nullable: boolean;
  default?: string;
}): string {
  let s = col.type;
  if (col.nullable === false) s += " NOT NULL";
  if (col.default !== undefined) s += ` DEFAULT ${col.default}`;
  return s;
}

// Render one CREATE TABLE column expression. `<type> PRIMARY KEY NOT NULL`
// matches the wire form the wizard/DDL services emit (`text ...` on SQLite,
// `varchar(36) ...` on MySQL), keeping kit re-introspection diff-free
// afterwards; a default on the key column is rendered rather than dropped.
// Which column is the key is decided by the caller — see `primaryKeyOf`.
function createTableColumn(
  col: { name: string; type: string; nullable: boolean; default?: string },
  dialect: AdditiveDialect,
  isPrimaryKey: boolean
): string {
  if (isPrimaryKey) {
    const def = col.default !== undefined ? ` DEFAULT ${col.default}` : "";
    return `${quote(col.name, dialect)} ${col.type} PRIMARY KEY NOT NULL${def}`;
  }
  return `${quote(col.name, dialect)} ${columnTail(col)}`;
}

// The name of the table's primary-key column, from the spec's `primaryKey`
// flag — the column descriptor owns that decision, so reading it here keeps
// a key named something other than `id` from silently losing its PRIMARY
// KEY, and a user field named `id` from accidentally becoming one.
//
// Specs written before the flag existed leave it undefined throughout (the
// same vintage as the absent-`indexes` sentinel handled below). Only for
// those does the historical `id` convention still decide, so an older
// snapshot cannot produce a table with no primary key at all.
function primaryKeyOf(spec: TableSpec): string | null {
  const declared = spec.columns.find(c => c.primaryKey === true);
  if (declared) return declared.name;
  const anyDeclared = spec.columns.some(c => c.primaryKey !== undefined);
  if (anyDeclared) return null;
  return spec.columns.some(c => c.name === "id") ? "id" : null;
}

// Emit Nextly's canonical secondary indexes for a managed table when the
// snapshot carries no tracked indexes (pre-C1 sentinel): UNIQUE on `slug`
// and DESC on `created_at` when those columns exist — same fallback the
// PostgreSQL emitter applies, minus the PG-only `USING btree` clause.
function createTableCanonicalIndexes(
  spec: TableSpec,
  dialect: AdditiveDialect
): string[] {
  const colNames = new Set(spec.columns.map(c => c.name));
  const stmts: string[] = [];
  if (colNames.has("slug")) {
    stmts.push(
      createIndexStatement(
        spec.name,
        { name: `idx_${spec.name}_slug`, columns: ["slug"], unique: true },
        dialect
      )
    );
  }
  if (colNames.has("created_at")) {
    const ifNotExists = dialect === "sqlite" ? "IF NOT EXISTS " : "";
    stmts.push(
      `CREATE INDEX ${ifNotExists}${quote(`idx_${spec.name}_created_at`, dialect)} ` +
        `ON ${quote(spec.name, dialect)} (${quote("created_at", dialect)} DESC)`
    );
  }
  return stmts;
}

export function emitAdditiveDdl(
  op: Operation,
  dialect: AdditiveDialect
): string[] {
  // `executePreResolutionOps` runs every op in PRE_RESOLUTION_OP_TYPES
  // before the emitter is reached, so emitting SQL for one here would
  // apply it a second time. That is a no-op for the statements that carry
  // IF EXISTS and fatal for the ones that cannot: MySQL's DROP INDEX has
  // no such form and fails the whole apply with ER_CANT_DROP_FIELD_OR_KEY.
  // Derived from the shared set rather than a copy of its members, so an
  // op MOVED into pre-resolution later stops being emitted here on the
  // same commit and the two cannot drift apart.
  if (isPreResolutionOp(op)) return [];

  switch (op.type) {
    case "rename_table":
    case "rename_column":
    case "drop_column":
    case "drop_table":
      // The set's members as of today. Unreachable behind the guard
      // above; kept so the switch stays exhaustive over Operation.
      return [];

    case "add_column":
      return [
        `ALTER TABLE ${quote(op.tableName, dialect)} ADD COLUMN ` +
          `${quote(op.column.name, dialect)} ${columnTail(op.column)}`,
      ];

    case "add_table": {
      const pkName = primaryKeyOf(op.table);
      const cols = op.table.columns.map(c =>
        createTableColumn(c, dialect, c.name === pkName)
      );
      const createTable = `CREATE TABLE ${quote(op.table.name, dialect)} (\n  ${cols.join(",\n  ")}\n)`;
      // Render the table's tracked indexes; fall back to the canonical
      // slug/created_at pair when the snapshot predates index tracking.
      const indexStmts =
        op.table.indexes !== undefined
          ? op.table.indexes.map(i =>
              createIndexStatement(op.table.name, i, dialect)
            )
          : createTableCanonicalIndexes(op.table, dialect);
      return [createTable, ...indexStmts];
    }

    case "add_index":
      return [createIndexStatement(op.tableName, op.index, dialect)];

    case "drop_index":
      // SQLite indexes live in a global namespace; MySQL scopes them to
      // the table and has no IF EXISTS form for DROP INDEX.
      return dialect === "sqlite"
        ? [`DROP INDEX IF EXISTS ${quoteIdent(op.index.name)}`]
        : [
            `DROP INDEX ${quoteIdentMysql(op.index.name)} ON ${quoteIdentMysql(op.tableName)}`,
          ];

    case "change_column_type":
    case "change_column_nullable":
    case "change_column_default":
      // Not emittable on SQLite (table rebuild) / MySQL (full MODIFY
      // definition) — canEmitWithoutDrizzleKit routes these to drizzle-kit.
      throw NextlyError.internal({
        logContext: {
          reason: "op-not-additive-emittable",
          op: op.type,
          dialect,
        },
      });

    default: {
      const exhaustive: never = op;
      throw NextlyError.internal({
        logContext: {
          reason: "unknown-emitter-op",
          op: JSON.stringify(exhaustive),
          dialect,
        },
      });
    }
  }
}

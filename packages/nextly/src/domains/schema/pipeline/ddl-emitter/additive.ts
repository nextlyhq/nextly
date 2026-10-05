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
import { createIndexSql } from "../sql-templates/create-index";
import { columnDefinition } from "../sql-templates/create-table-body";

import { createTableStatement, tableIndexStatements } from "./create-table";
import { quoteIdent, quoteIdentMysql } from "./identifiers";

export type AdditiveDialect = "sqlite" | "mysql";

function quote(identifier: string, dialect: AdditiveDialect): string {
  return dialect === "mysql"
    ? quoteIdentMysql(identifier)
    : quoteIdent(identifier);
}

// Render a single CREATE [UNIQUE] INDEX statement through the shared
// renderer, which owns IF NOT EXISTS (SQLite yes, MySQL has no such form),
// predicates, expressions and MySQL's TEXT/BLOB key prefix.
function createIndexStatement(
  tableName: string,
  index: IndexSpec,
  dialect: AdditiveDialect
): string {
  return createIndexSql(tableName, index, dialect, name =>
    quote(name, dialect)
  );
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

/**
 * A new table: its CREATE statement, then its indexes. Where its checks and
 * foreign keys go is `createTableStatement`'s to say.
 */
function createTableStatements(
  table: TableSpec,
  dialect: AdditiveDialect
): string[] {
  const q = (name: string) => quote(name, dialect);
  const createTable = createTableStatement(table, dialect, q);
  // Render the table's tracked indexes; fall back to the canonical
  // slug/created_at pair when the snapshot predates index tracking.
  const indexStmts =
    table.indexes !== undefined
      ? tableIndexStatements(table, dialect, q)
      : createTableCanonicalIndexes(table, dialect);
  return [createTable, ...indexStmts];
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
          columnDefinition(op.column, name => quote(name, dialect)),
      ];

    case "add_table":
      return createTableStatements(op.table, dialect);

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
    case "change_foreign_key_action":
    case "add_check":
    case "add_foreign_key":
    case "drop_check":
    case "drop_foreign_key":
      // Not emittable on SQLite (table rebuild) / MySQL (full MODIFY
      // definition) — canEmitWithoutDrizzleKit routes these to drizzle-kit.
      // A referential-action change is not additive either: it drops a live
      // constraint before redeclaring it, so it never belongs in the pass that
      // only adds things. Check DDL alters a live constraint for the same
      // reason, and the apply routes it through the statement templates.
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

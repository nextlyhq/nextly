// PostgreSQL DDL emitter. Converts pipeline Operation objects into SQL
// strings, bypassing drizzle-kit's slow catalog re-introspection.
//
// Contract: only called for ops that canEmitWithoutDrizzleKit() has
// already green-lit. rename_table / rename_column / drop_column /
// drop_table are executed by executePreResolutionOps BEFORE this runs,
// so they must emit nothing here (empty array) — emitting DDL for them
// would double-apply.

import { NextlyError } from "../../../../errors/nextly-error";
import type { IndexSpec, Operation, TableSpec } from "../diff/types";
import { createIndexSql } from "../sql-templates/create-index";
import { columnDefinition } from "../sql-templates/create-table-body";

import { createTableStatement, tableIndexStatements } from "./create-table";
import { quoteIdent } from "./identifiers";

/** Render a single CREATE [UNIQUE] INDEX statement for the apply fast-path. */
function createIndexStatement(tableName: string, index: IndexSpec): string {
  return createIndexSql(tableName, index, "postgresql", quoteIdent);
}

/**
 * Render the `USING` expression for an ALTER COLUMN TYPE migration.
 *
 * Why: Postgres only performs an implicit cast for a small set of
 * type-family transitions (e.g. `varchar` → `text`). For most cross-
 * family changes — including the common `text` → `jsonb` that occurs
 * when a Builder field is reclassified from a text-like type to a
 * `group` / `json` / `blocks` type — Postgres requires an explicit
 * `USING` clause or it errors with `cannot be cast automatically`.
 * Without that clause drizzle-kit's pushSchema historically skipped
 * the statement entirely while the journal still recorded the apply
 * as successful, leaving the live schema permanently drifted (see
 * the rext-site-v2 / `dc_case_studies` incident: 10 `*_section`
 * columns stuck on `text` despite repeated "successful" applies).
 *
 * Strategy: emit `USING "<col>"::<targetType>` for every change. The
 * `::` cast operator dispatches to whichever cast Postgres has
 * registered for the (source → target) pair. When no cast exists
 * (e.g. arbitrary `bytea` → `int4`) the statement fails loudly at
 * execution time, which is the desired behaviour — the operator
 * sees the failure, the transaction rolls back, and they can
 * provide a manual migration or backfill the column first. Silent
 * success is the bug we are fixing here; explicit failure is the
 * contract.
 */
function renderAlterTypeUsing(columnName: string, toType: string): string {
  return `USING ${quoteIdent(columnName)}::${toType}`;
}

// Emit Nextly's canonical secondary indexes for a managed collection
// table. Verified against a real Builder-created table on Neon
// (see Phase 4 plan, Task 8 background):
//   - UNIQUE btree on "slug" when present
//   - btree DESC on "created_at" when present
// PRIMARY KEY on "id" is handled by the inline PRIMARY KEY clause in
// the CREATE TABLE — Postgres creates the implicit "<table>_pkey"
// index automatically.
function createTableCanonicalIndexes(spec: TableSpec): string[] {
  const colNames = new Set(spec.columns.map(c => c.name));
  const stmts: string[] = [];
  if (colNames.has("slug")) {
    stmts.push(
      `CREATE UNIQUE INDEX ${quoteIdent(`idx_${spec.name}_slug`)} ` +
        `ON ${quoteIdent(spec.name)} USING btree (${quoteIdent("slug")})`
    );
  }
  if (colNames.has("created_at")) {
    stmts.push(
      `CREATE INDEX ${quoteIdent(`idx_${spec.name}_created_at`)} ` +
        `ON ${quoteIdent(spec.name)} USING btree (${quoteIdent("created_at")} DESC)`
    );
  }
  return stmts;
}

export function emitPostgresDdl(op: Operation): string[] {
  switch (op.type) {
    case "rename_table":
    case "rename_column":
    case "drop_index":
    case "drop_column":
    case "drop_table":
      // Already applied by executePreResolutionOps. Emit nothing.
      // drop_index moved into that set alongside drop_column: the index
      // must fall in the same phase as, and before, its column's drop
      // (SQLite rejects DROP COLUMN on an indexed column), so emitting it
      // here again would double-apply it on the fast path.
      return [];

    case "add_column":
      return [
        `ALTER TABLE ${quoteIdent(op.tableName)} ADD COLUMN ` +
          columnDefinition(op.column, quoteIdent),
      ];

    case "add_table": {
      const createTable = createTableStatement(
        op.table,
        "postgresql",
        quoteIdent
      );
      // C1: render the table's tracked indexes (slug/created_at + user/
      // relationship). When `indexes` is undefined (pre-C1 sentinel), fall
      // back to the legacy hardcoded canonical slug/created_at indexes.
      const indexStmts =
        op.table.indexes !== undefined
          ? tableIndexStatements(op.table, "postgresql", quoteIdent)
          : createTableCanonicalIndexes(op.table);
      return [createTable, ...indexStmts];
    }

    case "add_index":
      return [createIndexStatement(op.tableName, op.index)];

    case "change_column_type":
      return [
        `ALTER TABLE ${quoteIdent(op.tableName)} ` +
          `ALTER COLUMN ${quoteIdent(op.columnName)} ` +
          `SET DATA TYPE ${op.toType} ` +
          renderAlterTypeUsing(op.columnName, op.toType),
      ];

    case "change_column_nullable": {
      // Postgres requires the verb (SET / DROP) on its own statement;
      // there is no combined "SET NULLABLE" form.
      const verb = op.toNullable ? "DROP NOT NULL" : "SET NOT NULL";
      return [
        `ALTER TABLE ${quoteIdent(op.tableName)} ` +
          `ALTER COLUMN ${quoteIdent(op.columnName)} ${verb}`,
      ];
    }

    case "change_column_default": {
      // `toDefault === undefined` means "remove default"; any other
      // string is the raw default expression as written in DDL
      // (matches build-from-fields output: `'draft'`, `now()`, `0`,
      // `'{}'::jsonb`). We do not re-quote — callers own the literal
      // form, same contract as `add_column` and `add_table` use.
      const clause =
        op.toDefault === undefined
          ? "DROP DEFAULT"
          : `SET DEFAULT ${op.toDefault}`;
      return [
        `ALTER TABLE ${quoteIdent(op.tableName)} ` +
          `ALTER COLUMN ${quoteIdent(op.columnName)} ${clause}`,
      ];
    }

    case "change_foreign_key_action":
    case "add_check":
    case "add_foreign_key":
    case "drop_check":
    case "drop_foreign_key":
      // Deliberately outside the fast path: dropping and redeclaring a live
      // constraint — check DDL included — is not one of the additive
      // statements this emitter owns, and `FAST_PATH_OP_TYPES` does not list
      // it, so an apply carrying one routes elsewhere rather than arriving
      // here.
      throw NextlyError.internal({
        logContext: {
          reason: "op-not-fast-path-emittable",
          op: op.type,
          dialect: "postgresql",
        },
      });

    default: {
      const exhaustive: never = op;
      throw new Error(
        `emitPostgresDdl: unknown op ${JSON.stringify(exhaustive)}`
      );
    }
  }
}

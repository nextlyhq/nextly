// PostgreSQL DDL emitter. Converts pipeline Operation objects into SQL
// strings, bypassing drizzle-kit's slow catalog re-introspection.
//
// Contract: only called for ops that canEmitWithoutDrizzleKit() has
// already green-lit. rename_table / rename_column / drop_column /
// drop_table are executed by executePreResolutionOps BEFORE this runs,
// so they must emit nothing here (empty array) — emitting DDL for them
// would double-apply.

import type { Operation, TableSpec } from "../diff/types";

import { quoteIdent } from "./identifiers";

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

// Render the column tail shared by ADD COLUMN and CREATE TABLE column
// lists: `<type> [NOT NULL] [DEFAULT <expr>]`. `type` and `default` are
// dialect-ready tokens produced by diff/build-from-fields.ts (Postgres
// accepts them verbatim — `int4`, `varchar(255)`, `now()`, `'draft'`).
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

// Render one CREATE TABLE column expression. The synthetic `id` column
// is the collection-table primary key: build-from-fields emits it first
// with type "text" and nullable:false; drizzle-kit's canonical form is
// `"id" text PRIMARY KEY NOT NULL` (verified against a real Builder-
// created table on Neon).
function createTableColumn(col: {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
}): string {
  if (col.name === "id") {
    // PRIMARY KEY implies NOT NULL but we emit it explicitly to match
    // drizzle-kit's wire output exactly (downstream tooling that
    // textually scans the DDL won't be surprised).
    return `${quoteIdent(col.name)} ${col.type} PRIMARY KEY NOT NULL`;
  }
  return `${quoteIdent(col.name)} ${columnTail(col)}`;
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
    case "drop_column":
    case "drop_table":
      // Already applied by executePreResolutionOps. Emit nothing.
      return [];

    case "add_column":
      return [
        `ALTER TABLE ${quoteIdent(op.tableName)} ADD COLUMN ` +
          `${quoteIdent(op.column.name)} ${columnTail(op.column)}`,
      ];

    case "add_table": {
      const cols = op.table.columns.map(createTableColumn);
      const createTable = `CREATE TABLE ${quoteIdent(op.table.name)} (\n  ${cols.join(",\n  ")}\n)`;
      return [createTable, ...createTableCanonicalIndexes(op.table)];
    }

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

    default: {
      const exhaustive: never = op;
      throw new Error(
        `emitPostgresDdl: unknown op ${JSON.stringify(exhaustive)}`
      );
    }
  }
}

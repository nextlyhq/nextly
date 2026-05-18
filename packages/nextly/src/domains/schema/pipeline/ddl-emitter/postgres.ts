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
    case "change_column_nullable":
    case "change_column_default":
      throw new Error(
        `emitPostgresDdl: op type "${op.type}" not yet implemented — ` +
          `canEmitWithoutDrizzleKit should not have routed it here`
      );

    default: {
      const exhaustive: never = op;
      throw new Error(
        `emitPostgresDdl: unknown op ${JSON.stringify(exhaustive)}`
      );
    }
  }
}

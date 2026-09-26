// A new table as the dev-push emitters create it, rendered through the same
// statement templates a generated migration uses.
//
// The emitters used to spell CREATE TABLE and CREATE INDEX themselves, and the
// copies had drifted from the templates on exactly the parts that matter: a
// database-assigned key came out as a plain integer with no sequence or
// AUTO_INCREMENT, PostgreSQL gave the key PRIMARY KEY only when the column was
// named `id`, an expression index rendered as `()` and a partial index lost
// its predicate. The body and every index now come from `createTableBody` and
// `createIndexSql`, so a table pushed in development and the same table created
// by a migration are one rendering.
//
// What stays here is only what is the emitter's own: which column is the key
// for a spec old enough not to say, and where the table's checks and foreign
// keys go (see `createTableStatement`).

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { TableSpec } from "../diff/types";
import { createIndexSql } from "../sql-templates/create-index";
import {
  createTableBody,
  renderedType,
  resolvePrimaryKey,
  type QuoteIdentifier,
} from "../sql-templates/create-table-body";

/**
 * The spec with its key column marked (`resolvePrimaryKey`, shared with the
 * migration templates), and that column rendered NOT NULL whatever the spec's
 * nullability — the form the wizard and DDL services emit, so
 * re-introspection afterwards reads the same column back.
 */
function withResolvedPrimaryKey(table: TableSpec): TableSpec {
  const resolved = resolvePrimaryKey(table);
  return {
    ...resolved,
    columns: resolved.columns.map(c =>
      c.primaryKey === true ? { ...c, nullable: false } : c
    ),
  };
}

/**
 * The CREATE TABLE statement for a new table.
 *
 * SQLite takes a check or a foreign key in CREATE TABLE or not at all, so they
 * are declared inside it there. PostgreSQL and MySQL leave them out: `emitDdl`
 * adds them once every table of the apply exists, because a foreign key may
 * point at a table later in the same batch — and declaring them in both places
 * would add each one twice.
 */
export function createTableStatement(
  table: TableSpec,
  dialect: SupportedDialect,
  q: QuoteIdentifier
): string {
  const body = createTableBody(
    withResolvedPrimaryKey(table),
    q,
    "  ",
    dialect,
    {
      constraints: dialect === "sqlite",
    }
  );
  return `CREATE TABLE ${q(table.name)} (\n${body}\n)`;
}

/**
 * The new table's tracked indexes, one statement each.
 *
 * The table's own column list travels with them: MySQL can index a TEXT/BLOB
 * column only by prefix, and this is the one place the emitter knows which
 * columns those are. A standalone `add_index` has no such list, which is why
 * routing keeps that op away from this emitter on MySQL.
 */
export function tableIndexStatements(
  table: TableSpec,
  dialect: SupportedDialect,
  q: QuoteIdentifier
): string[] {
  const columnTypes = new Map(
    table.columns.map(c => [c.name, renderedType(c)])
  );
  return (table.indexes ?? []).map(index =>
    createIndexSql(table.name, index, dialect, q, { columnTypes })
  );
}

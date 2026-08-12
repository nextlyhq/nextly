/**
 * `CREATE TABLE` DDL derived from a Drizzle SQLite table definition.
 *
 * The core-table DDL in `sqlite-core-tables.ts` is written out by hand, for a
 * reason it states: the drizzle-kit push path needs a TTY, so a fallback that
 * survives without one cannot go through it. Agreement with the schema is
 * asserted by a test there instead.
 *
 * A table that only ever needs to exist inside a test has neither constraint.
 * It can be built from the schema object the production code already reads, so
 * there is nothing to keep in agreement: add a column to the schema and the
 * statement grows it too. That closes the failure mode a copied fixture has —
 * passing against a table shape no user runs, because the copy stopped
 * tracking the schema some commits ago.
 *
 * Scope is deliberately what a fixture needs: columns with their types,
 * nullability, primary key and uniqueness, plus the table's declared indexes.
 * Defaults are not emitted, so a caller inserts every NOT NULL column
 * explicitly — which a fixture wants anyway, since a row that leans on a
 * default is a row the test did not describe.
 *
 * @module database/sqlite-table-ddl
 */

import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * Ordered DDL that creates `table` and its indexes on a SQLite connection.
 *
 * Run the statements in sequence against better-sqlite3 (or any SQLite
 * adapter's executeQuery).
 */
export function sqliteTableDdl(table: SQLiteTable): string[] {
  const config = getTableConfig(table);

  const columns = config.columns.map(column => {
    const parts = [`"${column.name}"`, column.getSQLType()];
    // SQLite's PRIMARY KEY already implies the row is addressable; adding
    // NOT NULL alongside it is accepted but redundant, and `INTEGER PRIMARY
    // KEY` specifically must stay bare to remain the rowid alias.
    if (column.primary) parts.push("PRIMARY KEY");
    else if (column.notNull) parts.push("NOT NULL");
    if (column.isUnique) parts.push("UNIQUE");
    return `  ${parts.join(" ")}`;
  });

  const statements = [
    `CREATE TABLE IF NOT EXISTS "${config.name}" (\n${columns.join(",\n")}\n)`,
  ];

  for (const index of config.indexes) {
    const built = index.config;
    // A partial or expression index has no plain column list to name here.
    // Skipping it keeps the fixture honest: the table is created either way,
    // and a suite that needs the index asserts on it rather than inheriting
    // it silently.
    const names = built.columns
      .map(column => ("name" in column ? column.name : undefined))
      .filter((name): name is string => typeof name === "string");
    if (names.length !== built.columns.length) continue;

    const unique = built.unique ? "UNIQUE " : "";
    const quoted = names.map(name => `"${name}"`).join(", ");
    statements.push(
      `CREATE ${unique}INDEX IF NOT EXISTS "${built.name}" ON "${config.name}" (${quoted})`
    );
  }

  return statements;
}

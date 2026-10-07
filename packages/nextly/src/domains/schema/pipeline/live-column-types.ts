// The live type of every column of the given tables, for the Schema Builder's
// ALTER paths, which restate a column's own type verbatim when they must
// re-declare it.
//
// Derived from `introspectLiveColumns` — the one reading of a live column —
// rather than querying the catalog itself: two readers of one fact drift, and
// the diff and the Builder would then disagree about what a column is. The
// types are therefore exactly the diff's: PostgreSQL's `udt_name`, MySQL's
// declared `COLUMN_TYPE`, and SQLite's declared type lower-cased (SQLite type
// names are case-insensitive).
//
// Result shape: Map<tableName, Map<columnName, columnType>>, with a table that
// does not exist absent. Caller-provided tableNames restrict the scope to
// managed tables only — nothing outside them is read.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { introspectLiveColumns } from "./diff/introspect-live";

export async function queryLiveColumnTypes(
  db: unknown,
  dialect: SupportedDialect,
  tableNames: string[]
): Promise<Map<string, Map<string, string>>> {
  const snapshot = await introspectLiveColumns(db, dialect, tableNames);
  return new Map(
    snapshot.tables.map(table => [
      table.name,
      new Map(table.columns.map(column => [column.name, column.type])),
    ])
  );
}

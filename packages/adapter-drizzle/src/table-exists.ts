/**
 * Whether a table exists, asked of the database's own catalogue through
 * whichever executor the caller holds: the adapter's pool, or a transaction's
 * own connection.
 *
 * One lookup for both, so a check made inside a caller's transaction answers
 * exactly as the adapter's `tableExists` does. Inside a transaction it must
 * run on that transaction's connection: on a pool of one, asking the pool
 * waits for the connection the transaction holds and never returns. It reads
 * only the catalogue (`information_schema.tables`, `sqlite_master`), so a
 * table that does not exist is an answer, never a failed statement, which on
 * PostgreSQL would abort the transaction it ran in.
 *
 * @module table-exists
 */

import {
  createDatabaseError,
  type SqlParam,
  type SupportedDialect,
} from "./types";

/**
 * What runs the lookup: an adapter's pool, or a transaction's connection.
 *
 * @internal
 */
export interface CatalogExecutor {
  execute<T = unknown>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

/** The dialect's catalogue lookup for `tableName`, and its parameters. */
function tableExistsQuery(
  dialect: SupportedDialect,
  tableName: string,
  schema: string | undefined
): { sql: string; params: SqlParam[] } | undefined {
  switch (dialect) {
    case "postgresql":
      return {
        sql: `
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = COALESCE($1, (
                SELECT n.nspname FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.oid = to_regclass($2)
              ))
              AND table_name = $2
            ) as exists
          `,
        // Unqualified DDL and DML resolve across the whole search path, not against one
        // schema. Naming `public` reported a populated table as absent whenever a deployment
        // used a schema of its own, and naming only the FIRST entry misses a table that lives
        // further along it. `to_regclass` resolves exactly as the statements do, so the
        // lookup and the ALTER cannot disagree about which table is meant. A caller that
        // reads "absent" as "nothing to conflict with" would otherwise act on the wrong one.
        params: [schema ?? null, tableName],
      };
    case "mysql":
      return {
        sql: `
            SELECT COUNT(*) as count
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = ?
          `,
        params: [tableName],
      };
    case "sqlite":
      return {
        sql: `
            SELECT COUNT(*) as count
            FROM sqlite_master
            WHERE type = 'table'
            AND name = ?
          `,
        params: [tableName],
      };
    default:
      return undefined;
  }
}

/**
 * Whether `tableName` exists, asked through `executor`. Throws only for a
 * dialect with no lookup, or when the executor itself fails.
 *
 * @internal Exported for Nextly's own packages, which ask it inside a
 *   transaction they hold; not part of the adapter's public API.
 */
export async function tableExistsOn(
  executor: CatalogExecutor,
  dialect: SupportedDialect,
  tableName: string,
  schema?: string
): Promise<boolean> {
  const query = tableExistsQuery(dialect, tableName, schema);
  if (query === undefined) {
    throw createDatabaseError({
      kind: "query",
      message: `tableExists not implemented for dialect: ${String(dialect)}`,
    });
  }
  const [row] = await executor.execute<Record<string, unknown>>(
    query.sql,
    query.params
  );
  if (row === undefined) return false;
  // PostgreSQL answers { exists: true/false }; MySQL and SQLite { count: n }.
  if ("exists" in row) {
    return row.exists === true || row.exists === "t" || row.exists === 1;
  }
  if ("count" in row) return Number(row.count) > 0;
  return false;
}

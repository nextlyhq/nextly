// Shared helpers for naming the MySQL database a schema apply targets.
// drizzle-kit's MySQL pushSchema requires that name as a separate argument
// (PG and SQLite don't), so every caller has to supply it.
//
// Two ways to obtain it, and they are not interchangeable:
//
//   - `extractDatabaseNameFromUrl` reads it from a connection URL. Used by
//     per-call factories (reload-config.ts, the dispatchers, dev-server.ts)
//     that already hold the URL they connected with.
//   - `currentMysqlDatabaseName` asks the live connection. This is the
//     authoritative answer and the only one available to a caller that was
//     handed a connection rather than a URL — `process.env.DATABASE_URL` can
//     be unset, or can name a different database than the one the connection
//     actually selected.

import { NextlyError } from "../../../errors/nextly-error";

export function extractDatabaseNameFromUrl(
  url: string | undefined
): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    // Pathname is "/dbname" (with the leading slash) for mysql://
    // and postgres:// URLs. Strip the slash.
    const name = parsed.pathname.replace(/^\//, "");
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ask a live MySQL connection which database it selected.
 *
 * @param db a drizzle-orm/mysql2 database handle
 * @throws NextlyError when the connection has no database selected, which
 * makes every unqualified statement fail later and further from the cause.
 */
export async function currentMysqlDatabaseName(db: unknown): Promise<string> {
  const { sql: sqlTag } = await import("drizzle-orm");
  type AsyncExecuteDb = { execute: (q: unknown) => Promise<unknown> };
  // Tagged `sql` (not sql.raw): the query is static with no interpolation, so
  // the tagged form is the idiomatic, injection-safe default and keeps drizzle
  // in charge of parameter handling.
  const raw = await (db as AsyncExecuteDb).execute(
    sqlTag`SELECT DATABASE() AS db`
  );
  // drizzle-orm/mysql2 execute() resolves to [rows, fields].
  const rows = Array.isArray(raw) ? raw[0] : raw;
  const name = Array.isArray(rows)
    ? (rows[0] as { db?: string } | undefined)?.db
    : undefined;
  if (!name) {
    throw NextlyError.internal({
      logContext: {
        reason:
          "Could not determine the current MySQL database (SELECT DATABASE() " +
          "returned no name). Connect with a database selected in the " +
          "connection URL.",
      },
    });
  }
  return name;
}

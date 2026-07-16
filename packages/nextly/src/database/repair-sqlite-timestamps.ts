/**
 * One-time repair for timestamps SQLite stored as text.
 *
 * Collection entries are written inside a transaction, and the SQLite
 * transaction context used to bind a `Date` as an ISO string. The columns are
 * `integer({ mode: "timestamp" })`, and SQLite stores what it is given whatever
 * the declared type says, so the string landed in the column and only failed on
 * the way out: the timestamp decoder reads it as a number, gets NaN, and the
 * value surfaces as `null`.
 *
 * The writer now binds unix seconds. That fixes new rows and leaves old ones —
 * which is worse than either state on its own, because one column would hold
 * both encodings and SQLite compares across types by affinity, ordering every
 * integer before every string regardless of value. Sorting and range filters
 * would be quietly wrong on exactly the databases that look fixed.
 *
 * Raw SQL rather than Drizzle, unavoidably: `typeof()`, `PRAGMA table_info` and
 * `strftime` are SQLite intrinsics with no ORM equivalent, and the value cannot
 * be read through Drizzle at all — its decoder destroys it before we see it.
 * The same reason the core tables' DDL is raw.
 *
 * @module database/repair-sqlite-timestamps
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

/** Set once the repair has run, so it does not scan on every boot. */
export const TIMESTAMP_REPAIR_META_KEY = "sqlite.timestampRepair.v1";

/**
 * Matches the ISO-8601 shape the old writer produced (`2026-07-14T09:48:19.234Z`).
 *
 * A GLOB rather than a bare `typeof(...) = 'text'`: `strftime` returns NULL on
 * anything it cannot parse, and NULL is how this column says "never set". A
 * text value of another shape is not this bug, and turning it into NULL would
 * destroy it. Only what the old writer could have written is touched.
 */
const ISO_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*";

interface ColumnInfo {
  name: string;
  type: string;
}

interface TableInfo {
  name: string;
}

/** Quote an identifier for SQLite, doubling any embedded quotes. */
function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export interface RepairResult {
  /** Rows rewritten, across every table and column. */
  repaired: number;
  /** Columns that held at least one text timestamp. */
  columns: string[];
}

/**
 * Rewrite text timestamps as unix seconds, everywhere they occur.
 *
 * Driven by what the database itself declares rather than by a list of tables:
 * user-defined `date` fields are affected as much as the system columns, so a
 * hardcoded list would repair `created_at` and quietly leave `publishedAt`
 * broken. Every integer-declared column is a candidate, and the value's own
 * shape decides whether it is touched.
 *
 * Idempotent: a repaired column holds integers, which the `typeof` guard skips.
 */
export async function repairSqliteTimestamps(
  adapter: DrizzleAdapter
): Promise<RepairResult> {
  const result: RepairResult = { repaired: 0, columns: [] };

  const tables = await adapter.executeQuery<TableInfo>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  );

  for (const { name: table } of tables) {
    const columns = await adapter.executeQuery<ColumnInfo>(
      `PRAGMA table_info(${quote(table)})`
    );

    const candidates = columns.filter(
      (c: ColumnInfo) => c.type.toUpperCase() === "INTEGER"
    );

    for (const column of candidates) {
      // Ask before writing: the count is what gets reported, and a table with
      // nothing to fix should not be written to at all.
      const [{ n }] = await adapter.executeQuery<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${quote(table)}
          WHERE typeof(${quote(column.name)}) = 'text'
            AND ${quote(column.name)} GLOB $1`,
        [ISO_GLOB]
      );
      if (!n) continue;

      await adapter.executeQuery(
        `UPDATE ${quote(table)}
            SET ${quote(column.name)} =
                CAST(strftime('%s', ${quote(column.name)}) AS INTEGER)
          WHERE typeof(${quote(column.name)}) = 'text'
            AND ${quote(column.name)} GLOB $1`,
        [ISO_GLOB]
      );

      result.repaired += Number(n);
      result.columns.push(`${table}.${column.name}`);
    }
  }

  return result;
}

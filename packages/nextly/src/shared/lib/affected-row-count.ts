/**
 * The number of rows a write affected, read from the right field for the
 * running dialect.
 *
 * Each driver reports it somewhere different — better-sqlite3 as `changes`,
 * node-postgres as `rowCount`, mysql2 as a `ResultSetHeader.affectedRows`
 * (wrapped in an array on newer versions). There is no single field to read,
 * so any caller that reads one directly is correct on one dialect and silently
 * wrong on the others.
 *
 * "Silently" is the important part. A missing field yields `undefined`, which
 * `?? 0` turns into a plausible zero rather than an error — so an invalidation
 * that tombstoned fifty rows reports that it touched none, and a caller
 * branching on the count takes the wrong path with nothing to debug.
 *
 * @param result - Whatever the driver returned from the write.
 * @param dialect - The running dialect; decides which field carries the count.
 *
 * @module shared/lib/affected-row-count
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

export function affectedRowCount(
  result: unknown,
  dialect: SupportedDialect
): number {
  if (dialect === "sqlite") {
    return (result as { changes?: number }).changes ?? 0;
  }
  if (dialect === "postgresql") {
    return (result as { rowCount?: number }).rowCount ?? 0;
  }
  const header = Array.isArray(result)
    ? (result[0] as { affectedRows?: number } | undefined)
    : (result as { affectedRows?: number });
  return header?.affectedRows ?? 0;
}

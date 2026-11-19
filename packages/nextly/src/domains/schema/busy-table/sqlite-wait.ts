/**
 * SQLite's bound on one try's wait for the database: its busy timeout, set for the try and put
 * back after it. A module of its own, reading nothing of the schema lock or of a migration's
 * transaction, so each of them can bound a try with it.
 *
 * @module domains/schema/busy-table/sqlite-wait
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

/**
 * Sets SQLite's busy timeout to `tryMs` and returns what puts the connection's own back. Putting
 * it back is best effort: the unit has already ended, and a failure here must not change how.
 */
export async function boundSqliteWait(
  adapter: DrizzleAdapter,
  tryMs: number
): Promise<() => Promise<void>> {
  const [row] = await adapter.executeQuery<Record<string, unknown>>(
    "PRAGMA busy_timeout"
  );
  const previous = Number(Object.values(row ?? {})[0] ?? 0);
  await adapter.executeQuery(
    `PRAGMA busy_timeout = ${String(Math.round(tryMs))}`
  );
  return () =>
    adapter
      .executeQuery(
        `PRAGMA busy_timeout = ${String(Number.isFinite(previous) ? previous : 0)}`
      )
      .then(
        () => undefined,
        () => undefined
      );
}

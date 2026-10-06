/**
 * Reading a row under a lock that keeps its writers waiting, in a strength
 * the server accepts.
 *
 * For a read whose answer must hold for the rest of its transaction: an
 * update or delete of the row by another transaction waits until this one
 * commits, and this read waits for one already in flight, then reads what it
 * committed. The lock lasts only as long as the transaction the query runs
 * in, so the query must run inside one.
 *
 * - **PostgreSQL** takes `FOR SHARE`. Concurrent readers of the row share it;
 *   only writers wait.
 * - **MySQL** takes `FOR SHARE` for an existence check where the server
 *   accepts it (MySQL 8, Aurora, Vitess), so concurrent writes naming one
 *   account do not queue on its row. MariaDB and TiDB reject `FOR SHARE` as a
 *   syntax error and take `FOR UPDATE`, as does a server whose variant is not
 *   known: a lock that cannot fail to execute, at the cost that concurrent
 *   lockers of one row take turns. A session-row write takes `FOR UPDATE` on
 *   every MySQL server.
 * - **SQLite** reads without a lock: it has no row locks, and the caller's
 *   transaction already holds the database's write lock from its
 *   `BEGIN IMMEDIATE`, which serialises it against every writer.
 *
 * @module shared/lib/row-lock
 */
import type { DatabaseCapabilities } from "@nextlyhq/adapter-drizzle/types";

/** The row-lock strengths the Postgres and MySQL select builders take. */
export type RowLockStrength = "share" | "update";

/**
 * What a lock is for.
 *
 * - `session`: the session-row write, which locks one account per sign-in or
 *   refresh. Exclusive on MySQL, where it only orders concurrent sign-ins of
 *   that account.
 * - `existence-check`: the audit and activity writes that check the account
 *   they name still exists. Shared wherever the server accepts it, because
 *   every content write by an author takes one.
 */
export type RowLockUse = "session" | "existence-check";

/** The server facts the strength depends on: the adapter's capabilities. */
export type RowLockServer = Pick<
  DatabaseCapabilities,
  "dialect" | "sharedRowLock"
>;

/**
 * A select that can take a row lock. `.for()` exists on the Postgres and
 * MySQL builders; on SQLite it is never called.
 */
export type LockableRead<R> = Promise<R> & {
  for(strength: RowLockStrength): Promise<R>;
};

/** The lock `use` takes on `server`, or null where the read takes none. */
export function rowLockStrength(
  server: RowLockServer,
  use: RowLockUse
): RowLockStrength | null {
  switch (server.dialect) {
    case "postgresql":
      return "share";
    case "mysql":
      // `sharedRowLock` is unset until the adapter has read the server's
      // version: only an explicit yes asks for a lock some servers reject.
      return use === "existence-check" && server.sharedRowLock === true
        ? "share"
        : "update";
    case "sqlite":
      return null;
  }
}

/** Run `query` under the lock `use` takes on `server` (see the module doc). */
export function readUnderRowLock<R>(
  query: LockableRead<R>,
  server: RowLockServer,
  use: RowLockUse
): Promise<R> {
  const strength = rowLockStrength(server, use);
  return strength === null ? query : query.for(strength);
}

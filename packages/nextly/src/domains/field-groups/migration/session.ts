/**
 * The connection a field-group migration runs under.
 *
 * A migration that renames tables and rewrites rows must be the only one doing
 * so, and it must be able to prove it for the whole run rather than at the
 * moment it started. That needs an advisory lock, and an advisory lock is owned
 * by a connection: releasing it from a different connection than acquired it
 * releases nothing, and the lock then survives until the original connection
 * happens to close.
 *
 * So the session checks out one connection, takes the lock on that connection,
 * and holds both for the duration. Steps do NOT run on it. They open their own
 * transactions, because a step must commit on its own before its progress is
 * recorded, and a single enclosing transaction would let a rollback at the end
 * erase work the marker already reports as done. Advisory locks exclude other
 * connections regardless of which connection does the work, so mutual exclusion
 * survives that split.
 *
 * @module domains/field-groups/migration/session
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";

/** Dialects the migration runs on. */
export type MigrationDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Lock identity, distinct from the schema pipeline's own lock.
 *
 * The two guard different things, and conflating them would make an ordinary
 * schema sync and a storage migration appear to exclude each other by accident
 * rather than by decision. Keeping tools from colliding with a migration in
 * flight is the marker's job, not this lock's.
 */
export const MIGRATION_LOCK_NAME = "nextly_field_group_migration";

/**
 * Postgres advisory locks are keyed by a bigint rather than a name. A fixed
 * literal is used instead of hashing the name at runtime so the value is
 * greppable and cannot drift if the name is ever reworded.
 */
export const MIGRATION_LOCK_KEY = 8_053_119_204_411_001n;

/** What a step is handed to do its work. */
export interface MigrationSession {
  readonly dialect: MigrationDialect;
  /**
   * Run work in its own transaction, on its own connection.
   *
   * Deliberately not the session's pinned connection: each step commits
   * independently so that the progress marker, written after the commit,
   * never claims work that a later rollback could undo.
   */
  inTransaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Hold the migration lock for the duration of `fn`.
 *
 * Refuses rather than continuing when the lock cannot be taken. The schema
 * pipeline's lock helper logs a warning and proceeds unlocked when it gives up
 * waiting; that is survivable for an idempotent schema sync and is not
 * survivable here, where two concurrent runs would rename the same objects and
 * rewrite the same rows.
 */
export async function withMigrationSession<T>(
  args: { adapter: DrizzleAdapter; dialect: MigrationDialect },
  fn: (session: MigrationSession) => Promise<T>
): Promise<T> {
  const { adapter, dialect } = args;

  const session: MigrationSession = {
    dialect,
    inTransaction: work => adapter.transaction(work),
  };

  // SQLite has no advisory locks and needs none: one writer at a time is a
  // property of the database. Pinning here would also deadlock outright, since
  // the adapter serializes `transaction()` calls through a queue and an outer
  // transaction would hold that queue while every step waited on it.
  if (dialect === "sqlite") {
    return fn(session);
  }

  return adapter.transaction(async lock => {
    await acquire(lock, dialect);
    try {
      return await fn(session);
    } finally {
      // Released on the connection that took it. Anywhere else is a no-op that
      // leaves the lock held until the connection is recycled.
      await release(lock, dialect);
    }
  });
}

async function acquire(
  ctx: TransactionContext,
  dialect: Exclude<MigrationDialect, "sqlite">
): Promise<void> {
  const acquired =
    dialect === "mysql" ? await acquireMysql(ctx) : await acquirePostgres(ctx);

  if (!acquired) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration could not take the migration lock; another run holds it",
      logContext: { reason: "migration lock is held elsewhere", dialect },
    });
  }
}

async function acquireMysql(ctx: TransactionContext): Promise<boolean> {
  // Timeout 0 so this reports the conflict instead of blocking: a caller that
  // knows another run is in progress can decide to wait, a caller silently
  // parked inside a lock call cannot.
  const rows = await ctx.execute<{ locked: number | boolean | null }>(
    "SELECT GET_LOCK(?, 0) AS locked",
    [MIGRATION_LOCK_NAME]
  );
  const value = rows[0]?.locked;
  return value === 1 || value === true;
}

async function acquirePostgres(ctx: TransactionContext): Promise<boolean> {
  // Session-level rather than the `_xact_` variant, so the lock's lifetime is
  // the connection's and stays under this function's control.
  const rows = await ctx.execute<{ locked: boolean | null }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [MIGRATION_LOCK_KEY.toString()]
  );
  return rows[0]?.locked === true;
}

async function release(
  ctx: TransactionContext,
  dialect: Exclude<MigrationDialect, "sqlite">
): Promise<void> {
  if (dialect === "mysql") {
    await ctx.execute("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
    return;
  }
  await ctx.execute("SELECT pg_advisory_unlock($1)", [
    MIGRATION_LOCK_KEY.toString(),
  ]);
}

/**
 * Mutual exclusion for a field-group migration run.
 *
 * A migration that renames tables and rewrites rows must be the only one doing
 * so, for the whole run rather than at the instant it started.
 *
 * The lock is a row, not a connection-scoped advisory lock. An advisory lock is
 * owned by a connection, so holding one for a run means holding a pooled
 * connection for a run: with `pool.max: 1` the steps could then never check out
 * a connection of their own. MySQL's `GET_LOCK` is also scoped to the server
 * rather than the database, so two unrelated Nextly databases sharing a server
 * would exclude each other. A row has neither problem, behaves identically on
 * all three dialects, and is reached through the adapter's typed API instead of
 * dialect-specific SQL.
 *
 * There is deliberately no TTL and no auto-steal. Expiry needs a trusted clock,
 * and skew between application servers is precisely the case where two runs
 * would both conclude the lock had expired and proceed together. A run that
 * dies holding the lock leaves it held, and an operator clears it. For
 * something that rewrites customer data, refusing is the correct failure.
 *
 * @module domains/field-groups/migration/session
 */

import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

/** Dialects the migration runs on. */
export type MigrationDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Lock table, separate from the schema pipeline's `nextly_migrate_lock`.
 *
 * Plain text columns rather than a row in the `nextly_meta` key/value table:
 * that column holds JSON, and the dialects differ on whether a value returns
 * parsed or as a string. A lock is the wrong place to discover that.
 */
export const MIGRATION_LOCK_TABLE = "nextly_field_group_lock";

/** The lock is a single row; its key never varies. */
const LOCK_ROW_ID = 1;

/**
 * Read the lock row's owner inside a transaction.
 *
 * Issued as a Drizzle statement rather than through the typed query builder:
 * that resolves a table through the schema registry and rejects any name the
 * ORM does not declare, and this table is created on demand by the migration
 * rather than declared in the static schema — the same shape the schema
 * pipeline's own `nextly_migrate_lock` has.
 */
async function readOwner(
  ctx: TransactionContext
): Promise<{ owner: string | null } | undefined> {
  const rows = await ctx.queryStatement<{ owner: string | null }>(
    sql`SELECT ${sql.identifier("owner")}
        FROM ${sql.identifier(MIGRATION_LOCK_TABLE)}
        WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`
  );
  return rows[0];
}

/** Whether the single lock row is present, read outside any transaction. */
async function lockRowExists(adapter: DrizzleAdapter): Promise<boolean> {
  const rows = await adapter.queryStatement(
    sql`SELECT ${sql.identifier("id")}
        FROM ${sql.identifier(MIGRATION_LOCK_TABLE)}
        WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`
  );
  return rows.length > 0;
}

/** What a step is handed to do its work. */
export interface MigrationSession {
  readonly dialect: MigrationDialect;
  /**
   * Run work in its own transaction, on its own connection.
   *
   * Each step commits independently so that the progress marker, written after
   * the commit, never claims work a later rollback could undo.
   */
  inTransaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * DDL for the lock table.
 *
 * Exported so tests build it from the same source as production rather than
 * hand-copying CREATE TABLE statements that drift.
 */
export function getMigrationLockDdl(dialect: MigrationDialect): string[] {
  const idType = dialect === "mysql" ? "int" : "integer";
  return [
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_LOCK_TABLE} (id ${idType} PRIMARY KEY, owner text)`,
  ];
}

/**
 * Hold the migration lock for the duration of `fn`.
 *
 * Refuses rather than continuing when the lock is held. The schema pipeline's
 * helper logs a warning and proceeds unlocked once it gives up waiting; that is
 * survivable for an idempotent schema sync and is not survivable here, where
 * two runs would rename the same objects and rewrite the same rows.
 */
export async function withMigrationSession<T>(
  args: {
    adapter: DrizzleAdapter;
    dialect: MigrationDialect;
    label: string;
    /**
     * Take the lock only if it already exists, and never create it.
     *
     * For callers that are not the migration. The lock table is created by the
     * migration, so its absence means no run has ever happened on this database
     * and there is nothing to be excluded from. Creating it from those callers
     * would issue DDL on paths that promise none — `--no-auto-sync` exists
     * precisely to keep schema changes in migration files, and a role granted
     * DML but not DDL would be refused outright.
     */
    requireExistingLock?: boolean;
  },
  fn: (session: MigrationSession) => Promise<T>
): Promise<T> {
  const { adapter, dialect, label } = args;

  if (label.length === 0) {
    throw NextlyError.internal({
      logContext: { reason: "migration lock label must be a non-empty string" },
    });
  }

  // The claim is made unique here rather than trusted from the caller. A label
  // alone cannot be relied on: two processes resuming the same migration would
  // naturally pass the same one, and an occupied row that matched would let
  // both run, with the first to finish releasing the claim out from under the
  // second. Uniqueness by construction removes that whole class of mistake.
  const claim = `${label}#${randomUUID()}`;

  const session: MigrationSession = {
    dialect,
    inTransaction: work => adapter.transaction(work),
  };

  if (args.requireExistingLock === true) {
    // No lock table means no run has ever been recorded here, so there is
    // nothing to exclude and nothing worth creating a table for.
    if (!(await adapter.tableExists(MIGRATION_LOCK_TABLE))) return fn(session);
    await seedLockRow(adapter);
  } else {
    await ensureLockRow(adapter, dialect);
  }

  const acquired = await acquire(adapter, claim);
  if (!acquired.ok) {
    // Raised outside the transaction on purpose: the adapters route every error
    // escaping a transaction callback through `classifyError`, which rewraps
    // anything that is not already a DatabaseError and would strip this of its
    // status and its context.
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration could not take the migration lock; another run holds it",
      logContext: {
        reason: "migration lock is held elsewhere",
        heldBy: acquired.heldBy,
      },
    });
  }

  // A terminated process never reaches `finally`, and this lock has no expiry by
  // design, so an interrupted holder would leave a claim that only an operator
  // could clear. That is the right trade for a migration, which is rare and
  // deliberate; it is the wrong one for a schema sync, where the documented way
  // to stop watch mode is Ctrl+C and a stuck claim would block every later sync.
  // Releasing on the signal keeps the durable-claim design and removes its cost
  // on the path people actually interrupt.
  const releaseOnSignal = (signal: NodeJS.Signals): void => {
    void release(adapter, claim).finally(() => {
      process.kill(process.pid, signal);
    });
  };
  const onInterrupt = (): void => releaseOnSignal("SIGINT");
  const onTerminate = (): void => releaseOnSignal("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  try {
    return await fn(session);
  } finally {
    // Removed before releasing, so a signal arriving during an orderly release
    // cannot start a second one.
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    await release(adapter, claim);
  }
}

/**
 * Create the table and seed the single row.
 *
 * The row must exist before it can be locked, and seeding it here rather than
 * inside `acquire` keeps that path to one shape: lock, read, decide.
 */
async function ensureLockRow(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<void> {
  for (const statement of getMigrationLockDdl(dialect)) {
    await adapter.executeQuery(statement);
  }
  await seedLockRow(adapter);
}

/**
 * Seed the single lock row, assuming its table is already there.
 *
 * Separated from the DDL so a caller that must not issue schema changes can
 * still establish the row it needs to contend for.
 */
async function seedLockRow(adapter: DrizzleAdapter): Promise<void> {
  if (await lockRowExists(adapter)) return;

  try {
    await adapter.transaction(async ctx =>
      ctx.insert(MIGRATION_LOCK_TABLE, { id: LOCK_ROW_ID, owner: null })
    );
    return;
  } catch {
    // Losing a seed race is expected: the primary key decides and the loser
    // contends for the row that now exists. Any other failure is not expected,
    // and cannot be told apart from it portably, so instead of guessing at the
    // error the row is re-read below and required to exist.
  }

  if (!(await lockRowExists(adapter))) {
    // Continuing here would leave nothing to lock, and a claim written against
    // an absent row would update nothing while still looking successful.
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration could not establish its lock row; refusing to run unprotected",
      logContext: { reason: "migration lock row could not be established" },
    });
  }
}

type Acquisition = { ok: true } | { ok: false; heldBy: string | null };

/**
 * Claim the row, or report who holds it.
 *
 * Returns rather than throws so the refusal is raised by the caller, outside
 * the transaction, where it survives the adapter's error classifier.
 */
async function acquire(
  adapter: DrizzleAdapter,
  claim: string
): Promise<Acquisition> {
  return adapter.transaction(async ctx => {
    // Serializes contenders: everyone else waits here until this transaction
    // ends, so the read below cannot be overtaken between reading and writing.
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);

    const row = await readOwner(ctx);

    // Any occupied row refuses, including one that appears to be ours. Claims
    // are unique per invocation, so a match would mean something other than
    // this call wrote it.
    if (row === undefined || row.owner !== null) {
      return { ok: false, heldBy: row?.owner ?? null };
    }

    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
          SET ${sql.identifier("owner")} = ${claim}
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`
    );

    // Read back rather than trusting the write. An update reports affected rows
    // inconsistently across dialects, and an absent row would otherwise update
    // nothing and still look like a successful claim, running the migration
    // with no exclusion at all.
    const after = await readOwner(ctx);
    if (after?.owner !== claim) {
      return { ok: false, heldBy: after?.owner ?? null };
    }
    return { ok: true };
  });
}

/** Release only what we hold, so a late finaliser cannot free someone else's run. */
async function release(adapter: DrizzleAdapter, claim: string): Promise<void> {
  await adapter.transaction(async ctx => {
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);
    // Naming the owner as well makes a release affect only a row we still hold.
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
          SET ${sql.identifier("owner")} = NULL
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}
            AND ${sql.identifier("owner")} = ${claim}`
    );
  });
}

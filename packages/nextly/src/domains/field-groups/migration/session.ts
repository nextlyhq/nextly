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
import { sql, type SQL } from "drizzle-orm";

import { safeCode } from "../../../database/errors";
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
 * The single statement that reads the lock row's owner.
 *
 * Issued as a Drizzle statement rather than through the typed query builder:
 * that resolves a table through the schema registry and rejects any name the
 * ORM does not declare, and this table is created on demand by the migration
 * rather than declared in the static schema — the same shape the schema
 * pipeline's own `nextly_migrate_lock` has.
 *
 * Held as one function because two executors run it, and a second copy would be
 * free to disagree about which row the owner lives in.
 */
function ownerQuery(): SQL {
  return sql`SELECT ${sql.identifier("owner")}
      FROM ${sql.identifier(MIGRATION_LOCK_TABLE)}
      WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`;
}

/** The owner, read inside the transaction that is about to decide the claim. */
async function readOwner(
  ctx: TransactionContext
): Promise<{ owner: string | null } | undefined> {
  const rows = await ctx.queryStatement<{ owner: string | null }>(ownerQuery());
  return rows[0];
}

/**
 * The same read, on the adapter's own connection.
 *
 * Separate executor rather than a separate query — both issue `ownerQuery()`,
 * so the two cannot drift into disagreeing about which row the owner lives in.
 * An observing caller wants no transaction at all: opening one to read a single
 * row asks a read-only role for more than the read needs, which is the entire
 * failure this path exists to avoid.
 */
async function readOwnerOutsideTransaction(
  adapter: DrizzleAdapter
): Promise<{ owner: string | null } | undefined> {
  const rows = await adapter.queryStatement<{ owner: string | null }>(
    ownerQuery()
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

/**
 * What could be learned about the lock, including "nothing".
 *
 * 🔴 Three states rather than `string | null`, and `unknown` is the whole reason. A role that
 * cannot READ the lock table is not a database where nothing holds the lock, and collapsing the two
 * reports "safe to proceed" to precisely the restricted credential most likely to be unable to
 * look. "I could not ask" and "the answer is no" are different facts and this type refuses to merge
 * them.
 */
export type LockObservation =
  | { readonly kind: "held"; readonly owner: string }
  | { readonly kind: "not-held" }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * Whether a failed read means the table is not there.
 *
 * Classified by the driver's own code rather than by message text, and at the specificity the claim
 * needs: absent and FORBIDDEN are different codes, so a role denied SELECT lands in `unknown`
 * instead of being read as an empty database.
 *
 * SQLite is matched on message because it has no distinct code for this — and that is sound there
 * for a reason that does not generalise: SQLite has no table privileges, so a table it cannot find
 * is a table that does not exist. On Postgres and MySQL the same assumption is exactly the defect.
 */
function isMissingTable(error: unknown, dialect: MigrationDialect): boolean {
  // 🔴 Walked, not read off the top. Drizzle wraps a driver failure in a
  // `DrizzleQueryError` whose own message is just `Failed query` — on SQLite the
  // `no such table` text lives on `cause`, so reading only the outer message
  // classifies every FRESH database as unreadable rather than as one no run has
  // ever touched. Bounded because a cyclic `cause` is a hang, not a diagnosis.
  let link: unknown = error;
  for (
    let depth = 0;
    depth < 5 && link !== null && link !== undefined;
    depth++
  ) {
    const code = safeCode(link);
    const message = link instanceof Error ? link.message : "";

    if (dialect === "postgresql" && code === "42P01") return true;
    // Every spelling mysql2 offers, because `safeCode` prefers the SYMBOLIC
    // `code` and a check written only against the errno or the SQLSTATE never
    // matches the value it actually returns.
    if (
      dialect === "mysql" &&
      (code === "ER_NO_SUCH_TABLE" || code === "1146" || code === "42S02")
    ) {
      return true;
    }
    // SQLite has no distinct code — `SQLITE_ERROR` covers most failures — so the
    // message is the only discriminator. Sound here and nowhere else: SQLite has
    // no table privileges, so a table it cannot find is a table that is absent.
    if (dialect === "sqlite" && /no such table/i.test(message)) return true;

    link = (link as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Read the lock without claiming it, and say honestly when that could not be done.
 *
 * Reads the row DIRECTLY rather than asking whether the table exists first. `tableExists` resolves
 * through `information_schema`, which is filtered by privilege on Postgres and MySQL: a table the
 * role cannot see is reported absent, and the caller would then be told nothing holds the lock
 * while a migration was holding it.
 */
async function observeLock(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<LockObservation> {
  try {
    const owner = (await readOwnerOutsideTransaction(adapter))?.owner ?? null;
    return owner === null ? { kind: "not-held" } : { kind: "held", owner };
  } catch (error) {
    // The lock table is created by the first run that ever claims it, so its absence is a complete
    // answer: nothing can hold a lock whose table does not exist.
    if (isMissingTable(error, dialect)) return { kind: "not-held" };
    return {
      kind: "unknown",
      reason: safeCode(error) ?? "the lock could not be read",
    };
  }
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
  /**
   * What this session could learn about the lock.
   *
   * Under `claim` it is `held` by this session's own claim, which is simply true. Under `observe`
   * it is whatever the row said, or `unknown` when the read could not be made.
   *
   * Advisory in the strict sense: it describes an instant that has already passed. That is sound
   * for the only thing it is for — telling an operator their PREVIEW may be describing a moving
   * target — and unsound as a precondition for work. A caller that gates a write on it has
   * reimplemented the lock badly.
   */
  readonly lock: LockObservation;
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
    /**
     * Release the claim if the process is interrupted.
     *
     * For schema syncs only. Watch mode documents Ctrl+C as the way to stop, so
     * a claim that survived it would block every later sync — but a claim is
     * only safe to drop on a signal if whatever still holds it is harmless to
     * run twice, and a migration is not. Releasing a migration's claim would
     * free the row while its work is still in flight, letting a second process
     * resume the same run against a database the first is still writing to.
     *
     * So the migration keeps the strict behaviour this lock was designed for: an
     * interrupted run stays held, and an operator clears it.
     */
    releaseOnInterrupt?: boolean;
    /**
     * Whether this session takes the lock or merely looks at it.
     *
     * 🔴 `observe` writes NOTHING — no DDL, no row, no claim — which is the
     * whole point: claiming creates the table on first use, so a caller that
     * only reads was still issuing DDL and failing outright for a role with
     * read-only privileges. That made previewing a migration impossible with
     * exactly the credential an operator should be previewing production with.
     *
     * What it gives up is real and is not a technicality: nothing excludes a
     * concurrent run, so an `observe` session describes a snapshot that may
     * already be stale. That is acceptable only because such a session performs
     * no work — nothing acts on the answer, so a stale one costs an operator a
     * re-read rather than a wrong write. `observedLockOwner` reports the
     * contention that the claim would otherwise have raised as a refusal.
     *
     * Never use `observe` for a session that writes. The lock is what makes two
     * writers impossible, and this mode is precisely its absence.
     */
    mode?: "claim" | "observe";
  },
  fn: (session: MigrationSession) => Promise<T>
): Promise<T> {
  const { adapter, dialect, label, mode = "claim" } = args;

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
    // Replaced below for an observing session. A claiming one holds the lock itself, and saying so
    // is the accurate answer rather than a placeholder.
    lock: { kind: "held", owner: claim },
  };

  // Returns before anything that writes: the DDL, the seed row, the claim, the
  // signal handlers and the release are all below, and an observing session
  // must reach none of them. Placed above `requireExistingLock` because that
  // option still claims when the table happens to exist, which is a write.
  if (mode === "observe") {
    // The table's absence is a complete answer rather than a missing one: the
    // lock is created by the first run that ever claims it, so nothing can hold
    // a lock whose table does not exist. Asked with `tableExists` because
    // SELECTing a missing table raises a dialect-specific error that would have
    // to be recognised to be told apart from a permission failure — the guess
    // this mode exists to avoid.
    return fn({
      ...session,
      lock: await observeLock(adapter, dialect),
      // 🔴 Refused rather than documented. Handing the ordinary `inTransaction`
      // to an observing caller would let it write without ever holding the
      // lock, which is the one thing this whole module exists to prevent — and
      // the promise that it does not would rest on the callback's restraint
      // rather than on anything that could stop it. Today's caller happens not
      // to write; a rule nothing enforces is broken by whoever adds the next
      // one. `internal` rather than a service error because reaching here is a
      // programming mistake, not a state an operator can be in.
      inTransaction: () =>
        Promise.reject(
          NextlyError.internal({
            logContext: {
              reason:
                "an observing migration session cannot open a transaction",
              label,
            },
          })
        ),
    });
  }

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
  // on the path people actually interrupt — but only for callers that opt in.
  const releaseOnSignal = (signal: NodeJS.Signals): void => {
    // The signal is re-raised whether or not the release succeeded: a pool torn
    // down by the same interrupt is the likely failure, and an unobserved
    // rejection there would surface as an unhandled rejection instead of
    // letting the process stop. A claim left behind by a failed release is the
    // ordinary stuck-claim case an operator already has a remedy for.
    void release(adapter, claim)
      .catch(() => undefined)
      .finally(() => {
        process.kill(process.pid, signal);
      });
  };
  const onInterrupt = (): void => releaseOnSignal("SIGINT");
  const onTerminate = (): void => releaseOnSignal("SIGTERM");
  // Registered only where the claim is safe to drop mid-flight. The signal does
  // not stop `fn`, so releasing here hands the row to whoever asks next while
  // this process is still working — survivable for a sync, which was never
  // mutually exclusive with another sync, and not for a migration.
  if (args.releaseOnInterrupt === true) {
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
  }

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

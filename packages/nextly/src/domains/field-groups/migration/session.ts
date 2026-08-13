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
 * A claim carries an expiry that its holder RENEWS for as long as it is working,
 * so an expired claim is an observation that the holder stopped rather than a
 * guess about how long a migration ought to take. Every comparison is made by
 * the database, in one expression, so no part of it depends on two application
 * servers' clocks agreeing — which is what makes expiry safe here and is exactly
 * what a bare TTL cannot promise. A row whose expiry is NULL predates this
 * column and is treated as live: refusing until an operator clears it is
 * recoverable, and stealing the lock from a run that is still writing is not.
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
 * The single statement that reads the lock row: who holds it, and whether that claim is still live.
 *
 * Issued as a Drizzle statement rather than through the typed query builder:
 * that resolves a table through the schema registry and rejects any name the
 * ORM does not declare, and this table is created on demand by the migration
 * rather than declared in the static schema — the same shape the schema
 * pipeline's own `nextly_migrate_lock` has.
 *
 * 🔴 Liveness is decided HERE, in the same row read, because two callers ask it and they must not be
 * able to disagree. `acquire` uses it to decide whether to refuse; `observeMigrationLock` uses it to
 * tell an operator who holds the lock. A second spelling of "is this claim still live" would let a
 * preview report contention from a claim that a run would have taken over, and the two would look
 * correct read separately.
 *
 * The liveness test is a CASE rather than a boolean expression because the dialects return booleans
 * differently — `true`, `1` and `"1"` all occur — and a caller comparing against one of those three
 * is a per-dialect defect that unit doubles cannot see. An integer normalises through `Number()` on
 * every driver.
 */
function lockStateQuery(dialect: MigrationDialect): SQL {
  return sql`SELECT ${sql.identifier("owner")},
      CASE WHEN ${sql.identifier("owner")} IS NOT NULL
            AND (${sql.identifier("expires_at")} IS NULL
                 OR ${sql.identifier("expires_at")} > ${nowExpression(dialect)})
           THEN 1 ELSE 0 END AS ${sql.identifier("live")}
      FROM ${sql.identifier(MIGRATION_LOCK_TABLE)}
      WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`;
}

/** The lock row as the database reports it, with liveness already decided there. */
interface LockState {
  readonly owner: string | null;
  readonly live: boolean;
}

/** Read the row, or `undefined` when there is no row to read. */
function toLockState(
  row: { owner: string | null; live: unknown } | undefined
): LockState | undefined {
  if (row === undefined) return undefined;
  return { owner: row.owner, live: Number(row.live) === 1 };
}

/**
 * How long a claim stays valid without being renewed, and how often it is renewed.
 *
 * The TTL is short BECAUSE the holder renews: liveness is maintained by the renewal, so the TTL only
 * decides how quickly a dead holder's row becomes claimable. A long TTL there would mean a crash
 * wedges the next run for that long, which is the cost the renewal exists to avoid paying.
 *
 * The interval is a quarter of the TTL, so four consecutive renewals have to fail before the claim
 * lapses. A single slow query or a brief connection blip cannot lose a lock that is still held.
 */
export const LOCK_TTL_SECONDS = 120;
export const LOCK_RENEW_INTERVAL_MS = (LOCK_TTL_SECONDS / 4) * 1000;

/**
 * How many renewals must fail IN A ROW before the claim is treated as lost.
 *
 * DERIVED from the two constants above rather than written as 4, so the margin the comment
 * describes and the number the code enforces cannot drift apart when either is retuned. This is
 * the whole value of the interval being a fraction of the TTL: it buys exactly this many attempts.
 */
export const LOCK_RENEWALS_BEFORE_LOSS = Math.max(
  1,
  Math.floor((LOCK_TTL_SECONDS * 1000) / LOCK_RENEW_INTERVAL_MS)
);

/**
 * The database's own clock, and an expiry computed from it, per dialect.
 *
 * 🔴 Never the application's clock. Two processes contending for this row can sit on machines whose
 * clocks disagree, and a claim written from one clock and judged against another is decided by that
 * skew rather than by who holds the lock. Asking the server for both values means every comparison
 * happens in one frame of reference.
 *
 * SQLite stores this column as unix SECONDS (the Drizzle declaration uses `mode: "timestamp"`), so
 * its expressions are integer arithmetic rather than interval arithmetic.
 */
function nowExpression(dialect: MigrationDialect): SQL {
  if (dialect === "sqlite") return sql`unixepoch()`;
  return dialect === "mysql" ? sql`NOW()` : sql`now()`;
}

function expiryExpression(dialect: MigrationDialect): SQL {
  if (dialect === "sqlite") {
    return sql`unixepoch() + ${LOCK_TTL_SECONDS}`;
  }
  if (dialect === "mysql") {
    return sql`DATE_ADD(NOW(), INTERVAL ${LOCK_TTL_SECONDS} SECOND)`;
  }
  return sql`now() + make_interval(secs => ${LOCK_TTL_SECONDS})`;
}

/** The row, read inside the transaction that is about to decide the claim. */
async function readLockState(
  ctx: TransactionContext,
  dialect: MigrationDialect
): Promise<LockState | undefined> {
  const rows = await ctx.queryStatement<{
    owner: string | null;
    live: unknown;
  }>(lockStateQuery(dialect));
  return toLockState(rows[0]);
}

/** Renew this claim, and report whether it is still ours. */
async function renew(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  claim: string
): Promise<boolean> {
  return adapter.transaction(async ctx => {
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
          SET ${sql.identifier("expires_at")} = ${expiryExpression(dialect)}
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}
            AND ${sql.identifier("owner")} = ${claim}`
    );
    // Read back rather than trusting the update's affected-row count, which dialects report
    // inconsistently. If the row no longer names this claim, someone took the lock over and the work
    // this renewal was protecting is no longer protected.
    const after = await readLockState(ctx, dialect);
    return after?.owner === claim;
  });
}

/**
 * The same read, on the adapter's own connection.
 *
 * Separate executor rather than a separate query — both issue `lockStateQuery()`,
 * so the two cannot drift into disagreeing about which row the owner lives in
 * or about when a claim has lapsed. An observing caller wants no transaction at
 * all: opening one to read a single row asks a read-only role for more than the
 * read needs, which is the entire failure this path exists to avoid.
 */
async function readLockStateOutsideTransaction(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<LockState | undefined> {
  const rows = await adapter.queryStatement<{
    owner: string | null;
    live: unknown;
  }>(lockStateQuery(dialect));
  return toLockState(rows[0]);
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
export function isMissingTable(
  error: unknown,
  dialect: MigrationDialect
): boolean {
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
 *
 * A LAPSED claim reports `not-held`, because that is what a run contending for the row would find:
 * `acquire` takes it over. Reporting the dead claim's owner instead would name a holder that
 * excludes nobody, and the dry-run outcome that carries this observation would explain a torn read
 * with contention that cannot happen.
 */
export async function observeMigrationLock(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<LockObservation> {
  try {
    const state = await readLockStateOutsideTransaction(adapter, dialect);
    return state?.live === true && state.owner !== null
      ? { kind: "held", owner: state.owner }
      : { kind: "not-held" };
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
  // `expires_at` is what separates a run that is still working from one that died holding the row.
  // A holder renews it while it works, so an expired value is an OBSERVATION that the holder stopped
  // rather than a guess from a threshold. The type follows each dialect's existing convention for a
  // timestamp column, and must stay in step with the Drizzle declaration in
  // `schemas/field-group-lock/` — the round-trip guard is what holds them there.
  const expiresType =
    dialect === "postgresql"
      ? "timestamptz"
      : dialect === "mysql"
        ? "datetime"
        : "integer";
  return [
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_LOCK_TABLE} (id ${idType} PRIMARY KEY, owner text, expires_at ${expiresType})`,
  ];
}

/**
 * Add `expires_at` to a lock table created before that column existed.
 *
 * 🔴 `CREATE TABLE IF NOT EXISTS` is a NO-OP against an existing table, so every installation that
 * has run a Schema Builder change since the lock was introduced holds a two-column row that the
 * liveness read then references a missing column on. That is not a cosmetic upgrade wrinkle: the
 * exclusion takes this lock BEFORE the schema sync that would reconcile the column, so the
 * reconciliation which repairs it can never run — the upgrade path deadlocks on its own repair.
 *
 * Emitted separately from the CREATE rather than folded into it because the two answer different
 * questions, and a caller forbidden from issuing DDL needs to be able to skip both.
 */
export function getMigrationLockUpgradeDdl(dialect: MigrationDialect): string {
  const expiresType =
    dialect === "postgresql"
      ? "timestamptz"
      : dialect === "mysql"
        ? "datetime"
        : "integer";
  // PostgreSQL can say IF NOT EXISTS here; MySQL and SQLite cannot at the versions this supports,
  // so the duplicate is tolerated by CODE below rather than by syntax.
  const guard = dialect === "postgresql" ? "IF NOT EXISTS " : "";
  return `ALTER TABLE ${MIGRATION_LOCK_TABLE} ADD COLUMN ${guard}expires_at ${expiresType}`;
}

/**
 * Whether a failed ALTER means the column is already there.
 *
 * Classified by the driver's own code where one exists, at the specificity the claim needs — the
 * same discipline {@link isMissingTable} follows. A wrong answer here is not cosmetic in either
 * direction: swallowing a real failure would leave the column absent and every later read broken,
 * while treating "already present" as fatal would refuse every second run.
 */
function isDuplicateColumn(error: unknown, dialect: MigrationDialect): boolean {
  let link: unknown = error;
  for (
    let depth = 0;
    depth < 5 && link !== null && link !== undefined;
    depth++
  ) {
    const code = safeCode(link);
    const message = link instanceof Error ? link.message : "";

    // 42701 duplicate_column. Postgres also accepts IF NOT EXISTS, so this is the belt to that
    // brace rather than the only guard.
    if (dialect === "postgresql" && code === "42701") return true;
    if (
      dialect === "mysql" &&
      (code === "ER_DUP_FIELDNAME" || code === "1060" || code === "42S21")
    ) {
      return true;
    }
    // SQLite has no distinct code for this, and unlike the missing-table case there is no privilege
    // model to confuse it with: a duplicate column name is the only thing that produces this text.
    if (dialect === "sqlite" && /duplicate column name/i.test(message)) {
      return true;
    }

    link = (link as { cause?: unknown }).cause;
  }
  return false;
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
     * re-read rather than a wrong write. `lock` reports the contention that the
     * claim would otherwise have raised as a refusal.
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
    return fn({
      ...session,
      lock: await observeMigrationLock(adapter, dialect),
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
    //
    // 🔴 Reported as NOT HELD, not with the session's default. That default says
    // held-by-this-claim, which is true for a session that went on to acquire
    // and false on this path — the claim string was generated and never written
    // anywhere. Handing it out here would advertise ownership on the one branch
    // that deliberately takes no lock, so a caller inspecting it would see
    // exclusion exactly where there is none.
    if (!(await adapter.tableExists(MIGRATION_LOCK_TABLE))) {
      return fn({ ...session, lock: { kind: "not-held" } });
    }
    await seedLockRow(adapter);
  } else {
    await ensureLockRow(adapter, dialect);
  }

  const acquired = await acquire(adapter, dialect, claim);
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

  // 🔴 Renew for as long as the work runs. This is what makes the short TTL above safe: without it,
  // a migration outliving its TTL would have the row taken from underneath it and two runs would
  // rename the same objects — strictly worse than the refuse-always behaviour this replaces.
  //
  // What this CANNOT do is stop `fn`. JavaScript has no preemption, so a lost claim rejects the
  // caller's await and leaves whatever `fn` had already started running to completion. That is
  // stated rather than hidden: the guarantee here is that a run which loses its lock FAILS LOUDLY
  // and stops being waited on, not that its in-flight statement is cancelled. A step runner wanting
  // stronger behaviour should re-check between steps, which is the only place a cancellation could
  // land intact.
  let lostClaim: ((reason: unknown) => void) | undefined;
  // 🔴 Whether the claim was reported lost, and it is what decides the RELEASE below.
  //
  // Losing the claim does not stop `fn`, so a release on the way out would hand the row to the next
  // contender while this run is still renaming tables. That is not hypothetical for the transient
  // case: a renewal that failed on a blip leaves the row still owned by this claim, so the
  // owner-scoped release below matches and clears it. The run then continues writing with the lock
  // free. Leaving it alone is both safer and self-correcting — nothing renews it any more, so it
  // lapses on its own and the TTL performs exactly the recovery it exists for.
  let claimWasLost = false;
  const claimLost = new Promise<never>((_, reject) => {
    lostClaim = reject;
  });
  const onLost = (): void => {
    claimWasLost = true;
    lostClaim?.(
      NextlyError.serviceUnavailable({
        logMessage:
          "field-group migration lost its lock while running; another run may hold it",
        logContext: {
          reason: "migration lock claim lapsed or was taken over",
          label,
        },
      })
    );
  };
  // 🔴 Consecutive FAILURES, not failures. The TTL is four intervals wide precisely so a slow query
  // or a dropped connection cannot lose a lock that is still held, and treating the first error as
  // fatal spent that margin without using it — a brief blip aborted a healthy, half-finished
  // migration. Counted rather than timed: the margin is defined as a number of renewals, so
  // counting renewals states it directly and keeps the application's clock out of a decision that
  // has no business depending on it.
  let consecutiveFailures = 0;
  const renewal = setInterval(() => {
    void renew(adapter, dialect, claim).then(
      held => {
        // Ownership DISPROVED is not a margin question. The row names someone else, so no number of
        // retries can win it back and the work is already unprotected.
        if (!held) {
          onLost();
          return;
        }
        consecutiveFailures = 0;
      },
      () => {
        // An error is not proof the claim is gone — only proof this attempt could not ask. Retry
        // while the lease can still be kept alive, and give up once enough have failed in a row
        // that the next success could no longer land before the claim lapses.
        consecutiveFailures += 1;
        if (consecutiveFailures >= LOCK_RENEWALS_BEFORE_LOSS) onLost();
      }
    );
  }, LOCK_RENEW_INTERVAL_MS);
  // Never a reason for the process to stay alive: this timer exists to protect work that is already
  // running, so if nothing else is pending there is nothing left to protect.
  renewal.unref?.();

  try {
    return await Promise.race([fn(session), claimLost]);
  } finally {
    clearInterval(renewal);
    // Removed before releasing, so a signal arriving during an orderly release
    // cannot start a second one.
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    // 🔴 Not released once the claim was reported lost. `fn` is still running — nothing here can
    // stop it — so freeing the row would let the next contender start against a database this run
    // is still writing to, which is the precise outcome the lock exists to prevent. Doing nothing
    // is self-correcting: the renewal has stopped, so the claim lapses on its own and the next run
    // takes it over through the ordinary expiry path.
    if (!claimWasLost) await release(adapter, claim);
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

  // Runs unconditionally rather than behind a "does the column exist" probe, because the probe and
  // the ALTER would be two round trips racing each other — and the duplicate this may raise is
  // precisely the answer that probe would have returned.
  try {
    await adapter.executeQuery(getMigrationLockUpgradeDdl(dialect));
  } catch (error) {
    if (!isDuplicateColumn(error, dialect)) throw error;
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
  dialect: MigrationDialect,
  claim: string
): Promise<Acquisition> {
  return adapter.transaction(async ctx => {
    // Serializes contenders: everyone else waits here until this transaction
    // ends, so the read below cannot be overtaken between reading and writing.
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);

    const row = await readLockState(ctx, dialect);
    if (row === undefined) return { ok: false, heldBy: null };

    // 🔴 An occupied row refuses only while its claim is still LIVE. The holder renews for as long
    // as it is working, so an expiry in the past is an observation that the holder stopped — a
    // crashed run, or one killed between renewals — rather than a threshold guess about how long a
    // migration ought to take.
    //
    // A NULL expiry is treated as NOT expired, and that asymmetry is deliberate. It is the row a
    // previous release wrote, before this column existed, and the process that wrote it may still be
    // running. Stealing the lock from a live migration is unrecoverable; refusing until an operator
    // clears a stale row is merely inconvenient, and the state is transient anyway.
    //
    // The comparison was made by the DATABASE inside `lockStateQuery`, in one expression, so nothing
    // depends on the two contenders' clocks agreeing.
    if (row.live) return { ok: false, heldBy: row.owner };

    // The row is free or its claim has lapsed, and the row lock above means nothing can change that
    // before this commits — so the write names no owner. Predicating it on the owner we just read
    // would fail to take over a lapsed claim, which is the state this whole column exists to resolve.
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
          SET ${sql.identifier("owner")} = ${claim},
              ${sql.identifier("expires_at")} = ${expiryExpression(dialect)}
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`
    );

    // Read back rather than trusting the write. An update reports affected rows
    // inconsistently across dialects, and an absent row would otherwise update
    // nothing and still look like a successful claim, running the migration
    // with no exclusion at all.
    const after = await readLockState(ctx, dialect);
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
          SET ${sql.identifier("owner")} = NULL,
              ${sql.identifier("expires_at")} = NULL
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}
            AND ${sql.identifier("owner")} = ${claim}`
    );
  });
}

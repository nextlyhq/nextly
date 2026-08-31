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
import {
  deriveLeaseTimings,
  futureExpression,
  nowExpression,
} from "../../../database/lease-clock";
import { isMissingColumnError } from "../../../database/missing-column";
import { NextlyError } from "../../../errors/nextly-error";
import { fieldGroupLockColumnTypes } from "../../../schemas/field-group-lock";
import type { Logger } from "../../../shared/types";

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
           THEN 1 ELSE 0 END AS ${sql.identifier("live")},
      CASE WHEN ${sql.identifier("owner")} IS NOT NULL
            AND (${sql.identifier("expires_at")} IS NULL
                 OR ${sql.identifier("expires_at")} > ${futureExpression(dialect, LOCK_RENEW_MARGIN_SECONDS)})
           THEN 1 ELSE 0 END AS ${sql.identifier("usable")}
      FROM ${sql.identifier(MIGRATION_LOCK_TABLE)}
      WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`;
}

/**
 * The lock row as the database reports it, with both liveness questions already decided there.
 *
 * Two answers rather than one, because two callers ask genuinely different questions and collapsing
 * them would make one of them wrong. `live` is "would this claim still exclude a contender right
 * now", which is what an OBSERVER reports to an operator. `usable` is the stricter "will this claim
 * outlast the window in which its holder will not ask again", which is what a claimant needs before
 * it starts work: a lease shorter than that window is live and gone before anything re-checks it.
 *
 * Both are computed in the same statement, on the database's own clock, so no part of either
 * depends on this process's idea of the time.
 */
interface LockState {
  readonly owner: string | null;
  readonly live: boolean;
  readonly usable: boolean;
}

/** Read the row, or `undefined` when there is no row to read. */
function toLockState(
  row: { owner: string | null; live: unknown; usable: unknown } | undefined
): LockState | undefined {
  if (row === undefined) return undefined;
  return {
    owner: row.owner,
    live: Number(row.live) === 1,
    usable: Number(row.usable) === 1,
  };
}

/**
 * How long a claim stays valid without being renewed, and how often it is renewed.
 *
 * The TTL is short BECAUSE the holder renews: liveness is maintained by the renewal, so the TTL only
 * decides how quickly a dead holder's row becomes claimable. A long TTL there would mean a crash
 * wedges the next run for that long, which is the cost the renewal exists to avoid paying.
 *
 * The interval is a small fraction of the TTL so that several attempts fit inside it: a slow query
 * or a brief connection blip must not lose a lock that is still held. Attempts cost one single-row
 * update each and never pile up, because only one is ever in flight.
 */
export const LOCK_TTL_SECONDS = 120;

/**
 * How many renewals fit in one TTL. The only number chosen here; every other timing below is
 * derived from it, so no two of them can drift apart.
 */
const LOCK_RENEW_DIVISOR = 8;

const LOCK_TIMINGS = deriveLeaseTimings(LOCK_TTL_SECONDS, LOCK_RENEW_DIVISOR);

export const LOCK_RENEW_INTERVAL_MS = LOCK_TIMINGS.renewIntervalMs;

/**
 * How long the session may go without CONFIRMING its lease before it declares the claim lost.
 *
 * 🔴 Elapsed time, NOT a count of failed attempts. A count answers "how many renewals went wrong",
 * which is only a proxy for the question that decides safety — "how much lease is left" — and it is
 * a proxy that fails in two independent ways. Attempts can OVERLAP, so completions arrive out of
 * order and a stale failure can be counted against a lease a later success already extended; and
 * the count reaches its limit at the moment the lease expires rather than before it, so the work
 * runs unprotected right up to the deadline and is told only once it is already past.
 *
 * Measuring the gap since the last confirmation has neither problem. A late success moves the
 * confirmation forward and a late failure moves nothing, so ordering stops mattering; and the
 * threshold can sit wherever the margin needs to be. Here it leaves TWO renewal intervals of lease
 * still in hand, so the caller is told while it is still protected rather than after.
 */
export const LOCK_LOSS_AFTER_MS = LOCK_TIMINGS.lossAfterMs;

/**
 * How long a shutdown waits for an in-flight legacy claim before giving up on releasing it.
 *
 * The wait exists so the release cannot run against a row whose claim has not decided. The BOUND
 * exists because a stalled connection may never answer, and an interrupt that never re-raises means
 * the operator's Ctrl+C silently did nothing — a worse failure than the claim it was protecting.
 * Short, because the only thing being waited for is one single-row transaction.
 *
 * Past the bound the release is SKIPPED rather than issued blind, so a claim can be left behind:
 * the row's state is unknown at that point, and clearing it could free a claim this process is
 * about to write. A claim an operator clears is recoverable; a row freed under a live claim is not.
 */
export const LEGACY_SHUTDOWN_WAIT_MS = 5_000;

/**
 * How much lease a confirmation must actually grant for the holder to rely on it.
 *
 * 🔴 "Not yet expired" is not the same as "safe to work on", and neither is "lasts until the next
 * renewal". The write and the read-back are separate statements, so a process descheduled between
 * them comes back to a claim that passes a liveness test with almost nothing left.
 *
 * 🔴 DERIVED from the loss deadline, not chosen alongside it. Confirming a lease is what STARTS the
 * window in which this session will not ask again, so a confirmation granting less than that window
 * is a promise the row cannot keep: the session sits for the whole window believing it is protected
 * while the row expires partway through, and a contender takes it. Two independently chosen numbers
 * would only have to differ for that gap to open — with a one-interval margin the confirmed lease
 * could be 16 seconds while the session went 90 without checking, leaving 74 seconds unprotected.
 * Tying the requirement to the window makes them agree by construction instead.
 */
export const LOCK_RENEW_MARGIN_SECONDS = LOCK_TIMINGS.renewMarginSeconds;

function expiryExpression(dialect: MigrationDialect): SQL {
  return futureExpression(dialect, LOCK_TTL_SECONDS);
}

/** The row, read inside the transaction that is about to decide the claim. */
async function readLockState(
  ctx: TransactionContext,
  dialect: MigrationDialect
): Promise<LockState | undefined> {
  const rows = await ctx.queryStatement<{
    owner: string | null;
    live: unknown;
    usable: unknown;
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
    //
    // 🔴 OWNERSHIP AND LIVENESS, not ownership alone. The row can name this claim and still be
    // expired: if the transaction is suspended, descheduled or simply slow between writing the
    // expiry and reading it back, more than the TTL can elapse inside it. `readLockState` reports
    // that correctly as `live: false`, and an owner-only check discards exactly the field that
    // says so — reporting a successful renewal on a lease a contender may take the instant this
    // commits, while the callback carries on believing it is protected.
    const after = await readLockState(ctx, dialect);
    return after?.owner === claim && after.usable;
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
    usable: unknown;
  }>(lockStateQuery(dialect));
  return toLockState(rows[0]);
}

/**
 * Whether this lock table is new enough to answer a liveness read.
 *
 * Issues the REAL state query rather than inspecting a catalogue, so it cannot drift from the
 * statement acquisition is about to run: if this one succeeds, that one will too.
 */
async function lockTableUnderstandsExpiry(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<boolean> {
  try {
    await readLockStateOutsideTransaction(adapter, dialect);
    return true;
  } catch (error) {
    if (isMissingColumnError(error)) return false;
    throw error;
  }
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
  // `expires_at` is what separates a run that is still working from one that died holding the row.
  // A holder renews it while it works, so an expired value is an OBSERVATION that the holder stopped
  // rather than a guess from a threshold. Every type here comes from the Drizzle declaration in
  // `schemas/field-group-lock/`, so the bootstrap and the reconcile cannot describe two shapes.
  const types = fieldGroupLockColumnTypes(dialect);
  return [
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_LOCK_TABLE} (id ${types.id} PRIMARY KEY, owner ${types.owner}, expires_at ${types.expires_at})`,
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
  // Same source as the CREATE above, so the column an old installation gains is the column a new
  // one is born with. Two independent mappings here would leave upgraded databases a different
  // shape from fresh ones, and nothing downstream distinguishes them.
  const expiresType = fieldGroupLockColumnTypes(dialect).expires_at;
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
    /** Where a skipped lock is reported. Absent means the skip is silent, which is a caller's choice. */
    logger?: Logger;
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

    // 🔴 A lock table created before `expires_at` existed cannot answer the liveness read, and THIS
    // branch is forbidden from adding it — the upgrade ALTER runs only where DDL is allowed. So the
    // lock is taken through the `owner` column alone, which every version of this table has.
    //
    // Claiming rather than skipping, and rather than refusing outright. Skipping was the earlier
    // answer and it left the sync running with NO exclusion at all, free to be overtaken by a
    // migration that started during it. Refusing would break every `--no-auto-sync` install that has
    // not yet run a migration under this release, which is a certain outage in place of a narrow
    // risk. An owner-only claim is real exclusion and writes no DDL.
    //
    // What it gives up: no expiry means NO TAKEOVER, so an occupied legacy row refuses until an
    // operator clears it and a killed process leaves a claim behind. That is the contract this lock
    // had BEFORE `expires_at` existed rather than a new hazard, and the remedy is the same single
    // migration run, which adds the column on the branch that may.
    if (!(await lockTableUnderstandsExpiry(adapter, dialect))) {
      // Describes the TABLE, which is established, rather than this session's outcome, which is not
      // known until the claim below either succeeds or is refused. Saying "holding it by owner
      // alone" here told an operator they held a lock and then, on the next line, that someone else
      // did — and said it just as confidently when acquisition failed on a database error.
      args.logger?.warn?.(
        "field-group migration lock predates its expiry column; falling back to an owner-only claim",
        {
          reason: "migration lock table is missing expires_at",
          table: MIGRATION_LOCK_TABLE,
          label,
        }
      );

      // 🔴 Installed BEFORE the claim is attempted, not after it returns.
      //
      // The database commits the claim inside `acquireOwnerOnly`; this process then has to be
      // scheduled again before the next line runs. A signal landing in that gap would take the
      // default termination path with the row already owned — and this claim has NO EXPIRY to lapse,
      // so the strand does not merely block the next sync: it blocks the migration that would add
      // `expires_at`, making the one action that permanently repairs the database the action the
      // strand prevents. Watch mode documents Ctrl+C as the way to stop, so the window is on the
      // ordinary path rather than an exotic one.
      //
      // Registering early is safe precisely because the release is OWNER-SCOPED: a signal arriving
      // before the claim was taken clears nothing, because the row does not name this claim. There
      // is no symmetric hazard to trade against, which is what makes "earlier" strictly better here
      // rather than a different bet.
      let legacyReleasedOnSignal = false;
      // 🔴 The claim in flight, so an interrupt can WAIT for it rather than race it.
      //
      // The handler locks the same row. Issued while `acquireOwnerOnly` is still committing, its
      // release can clear nothing — the row is not yet ours — and the claim then lands behind it,
      // stranding an owner with no expiry to lapse. Ordering the two removes that: the release runs
      // only once the claim has DECIDED, so either it landed and the release clears it, or it did
      // not and there is nothing to clear. Nothing here depends on which of them is faster.
      //
      // The same shape the renewal path uses further up, where an in-flight attempt is settled
      // before the claim is released.
      let pendingAcquisition: Promise<unknown> = Promise.resolve();
      const releaseLegacyOnSignal = (signal: NodeJS.Signals): void => {
        legacyReleasedOnSignal = true;
        // SETTLED, not awaited for success: a claim that REJECTED must not hold up the shutdown,
        // and its rejection is already observed by the caller's own await.
        //
        // 🔴 BOUNDED, because a transaction on a stalled connection may never settle at all and a
        // signal that never re-raises means Ctrl+C stopped working — the operator's last resort
        // silently doing nothing. Past the bound the release is skipped rather than issued blind:
        // the claim's outcome is unknown, so clearing the row could free one this process is about
        // to write. A claim left behind is the recoverable side of that choice.
        void Promise.race([
          Promise.allSettled([pendingAcquisition]).then(() =>
            releaseOwnerOnly(adapter, claim)
          ),
          new Promise(resolve =>
            setTimeout(resolve, LEGACY_SHUTDOWN_WAIT_MS).unref?.()
          ),
        ])
          // The signal is re-raised whether or not the release succeeded, exactly as the
          // expiry-aware path does it: a pool torn down by the same interrupt is the likely
          // failure, and an unobserved rejection would surface instead of letting the process stop.
          .catch(() => undefined)
          .finally(() => {
            process.kill(process.pid, signal);
          });
      };
      const onLegacyInterrupt = (): void => releaseLegacyOnSignal("SIGINT");
      const onLegacyTerminate = (): void => releaseLegacyOnSignal("SIGTERM");
      if (args.releaseOnInterrupt === true) {
        process.once("SIGINT", onLegacyInterrupt);
        process.once("SIGTERM", onLegacyTerminate);
      }

      // 🔴 ONE `try` covers the acquisition, the work and the release, and the handlers come off in
      // its `finally` — not at three separate points.
      //
      // Sliding the removal earlier or later just moves the gap: taken off before the release, a
      // signal in that window strands the claim; done only on the `!ok` branch, an acquisition that
      // REJECTS (a dropped connection, an UPDATE permission error) skips the cleanup entirely and
      // leaks two process-wide listeners per attempt, which watch mode repeats. Spanning everything
      // that can throw is the answer that has no next window.
      //
      // Keeping them live THROUGH the release is safe: `releaseOwnerOnly` is owner-scoped and
      // idempotent, so a signal landing mid-release clears a row that is already being cleared and
      // then re-raises. Doing it twice costs nothing; not doing it at all strands a claim that has
      // no expiry to lapse.
      try {
        // Assigned BEFORE it is awaited, so an interrupt landing mid-commit has something to wait
        // for. Awaiting it here is also what observes a rejection, so the handler's `allSettled`
        // never leaves one unhandled.
        pendingAcquisition = acquireOwnerOnly(adapter, claim);
        const legacy = (await pendingAcquisition) as Acquisition;
        if (!legacy.ok) {
          // Refused for the same reason the expiry-aware path refuses, and it is a REFUSAL rather
          // than a skip: the row names a holder, and without an expiry there is no basis on which
          // to call that holder dead. Proceeding would run the sync against storage a migration may
          // be renaming, which is the outcome this whole module exists to prevent.
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration lock is held; another run holds a claim on a lock table that predates its expiry column",
            logContext: {
              reason: "migration lock is held elsewhere",
              heldBy: legacy.heldBy,
              table: MIGRATION_LOCK_TABLE,
              label,
            },
          });
        }

        // 🔴 Shutdown wins over starting new work, and the ordering is the reason this check is
        // needed rather than implied. A signal arriving during acquisition schedules the handler's
        // release, but the `await` above resumes FIRST — its continuation was registered earlier —
        // so without this the callback starts, the handler then clears the row underneath it, and a
        // migration is free to take the lock while a schema sync is still writing. That is the
        // exact overlap the lock exists to prevent, reached by way of the shutdown that was meant
        // to stop everything.
        if (legacyReleasedOnSignal) {
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration lock was released for shutdown before the work began",
            logContext: {
              reason: "interrupted before the work started",
              table: MIGRATION_LOCK_TABLE,
              label,
            },
          });
        }

        // Held for real, so the caller is told so rather than being handed `not-held`. Nothing
        // renews it, because there is no lease to extend — see `acquireOwnerOnly` for what that
        // gives up.
        let heldToTheEnd = true;
        // 🔴 Three outcomes, not two. "The row stopped being ours" and "the release could not run"
        // are different facts with different remedies, and collapsing them into one boolean is the
        // failure-semantics mistake this codebase keeps finding: the first means another run may
        // have overlapped this one, the second means the claim is probably still sitting there.
        let releaseFailure: unknown;
        let legacyResult: T;
        try {
          legacyResult = await fn({
            ...session,
            lock: { kind: "held", owner: claim },
          });
        } finally {
          // 🔴 This `finally` must not THROW. A rejection here replaces whatever `fn` raised, so a
          // connection dropping during cleanup would hide the actual sync failure behind a cleanup
          // failure — and the caller's own error staying primary is a promise this module makes a
          // few lines up. The outcome is recorded and judged after the block instead.
          heldToTheEnd = await releaseOwnerOnly(adapter, claim).then(
            held => held,
            error => {
              releaseFailure = error;
              return false;
            }
          );
        }

        // Reached only when `fn` RESOLVED; a rejection propagates from the block above with the
        // caller's failure intact.
        if (releaseFailure !== undefined) {
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration finished but could not release its lock; the claim may still be held",
            logContext: {
              reason: "migration lock release failed",
              table: MIGRATION_LOCK_TABLE,
              label,
            },
            cause: releaseFailure instanceof Error ? releaseFailure : undefined,
          });
        }
        // An interrupt is an orderly shutdown that already signalled its outcome, so it is not a
        // lost claim.
        if (!heldToTheEnd && !legacyReleasedOnSignal) {
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration finished without holding its lock; another run may have overlapped it",
            logContext: {
              reason: "migration lock was not held at completion",
              table: MIGRATION_LOCK_TABLE,
              label,
            },
          });
        }
        return legacyResult;
      } finally {
        // The ONE removal point, reached however this branch ends: a refused claim, a rejected
        // acquisition, a thrown callback, or an orderly return.
        process.off("SIGINT", onLegacyInterrupt);
        process.off("SIGTERM", onLegacyTerminate);
      }
    }
  } else {
    await ensureLockRow(adapter, dialect);
  }

  // Stamped before the attempt for the same reason the renewal is: the lease this claim grants
  // begins when the database runs the statement, so dating it from here can only understate what is
  // left. Reading the clock after `acquire` resolves would credit the claim with time it spent
  // waiting for a connection or for this process to be scheduled again.
  const claimStartedAt = performance.now();
  const acquired = await acquire(adapter, dialect, claim);
  if (!acquired.ok) {
    // Raised outside the transaction on purpose: the adapters route every error
    // escaping a transaction callback through `classifyError`, which rewraps
    // anything that is not already a DatabaseError and would strip this of its
    // status and its context.
    throw NextlyError.serviceUnavailable({
      /*
       * "Try again later" is wrong advice for half of what reaches here.
       *
       * A lock table that predates `expires_at` grants an owner-only claim,
       * which has no takeover — so a killed process leaves a claim that no
       * later run can reclaim, and every schema change refuses until an
       * operator intervenes. Retrying cannot start working, and the default
       * message asks the caller to do exactly that.
       *
       * Both causes are named because this code cannot tell them apart: that
       * is the same missing expiry. Saying which one it is would be a guess,
       * and naming only the transient one is what left a developer restarting
       * a server that was never going to recover.
       */
      publicMessage:
        "The schema is locked by another run. If none is in progress, the " +
        "lock predates its expiry column and cannot be reclaimed " +
        "automatically — run `nextly migrate:field-groups` to add it.",
      logMessage:
        "field-group migration could not take the migration lock; another run holds it",
      logContext: {
        reason: "migration lock is held elsewhere",
        heldBy: acquired.heldBy,
      },
    });
  }

  // 🔴 The claim passed its checks INSIDE the transaction; getting back here is a separate step that
  // can take arbitrarily long — the commit itself, the driver resolving, this process being
  // scheduled again. `acquire` cannot see any of that, and the first elapsed-time check is a whole
  // interval away, so without this the callback starts on a lease that may already have lapsed and
  // nothing notices until a renewal disproves ownership.
  //
  // Refuses rather than renewing: a run that has already spent its safety margin before doing any
  // work has nothing to lose by starting over, and re-extending here would paper over whatever
  // stalled. The row is cleared for the same reason a refused acquisition clears it — leaving this
  // claim behind would block contenders with nothing renewing it.
  if (performance.now() - claimStartedAt >= LOCK_LOSS_AFTER_MS) {
    await release(adapter, dialect, claim);
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration took too long to take its lock; the claim may already have lapsed",
      logContext: {
        reason:
          "migration lock claim aged past its safety window during acquisition",
        label,
      },
    });
  }

  // A terminated process never reaches `finally`, so an interrupted holder leaves a claim behind.
  // The expiry means that claim now LAPSES on its own rather than waiting for an operator — but it
  // takes the whole TTL to do so, because nothing is renewing it and nothing knows it is dead.
  // That wait is the right trade for a migration, which is rare and deliberate; it is the wrong one
  // for a schema sync, where the documented way to stop watch mode is Ctrl+C and a stale claim would
  // stall every later sync for two minutes. Releasing on the signal removes that wait on the path
  // people actually interrupt — but only for callers that opt in.
  // Set by the signal path so the completion check below can tell a claim this run GAVE UP
  // deliberately from one a contender took. Both leave the row not-ours at the end and only the
  // second is a failure — an interrupt is an orderly shutdown that already signalled its outcome.
  let releasedOnSignal = false;
  const releaseOnSignal = (signal: NodeJS.Signals): void => {
    releasedOnSignal = true;
    // The signal is re-raised whether or not the release succeeded: a pool torn
    // down by the same interrupt is the likely failure, and an unobserved
    // rejection there would surface as an unhandled rejection instead of
    // letting the process stop. A claim left behind by a failed release is the
    // ordinary stuck-claim case an operator already has a remedy for.
    void release(adapter, dialect, claim)
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
  // 🔴 A MONOTONIC clock, and an ELAPSED span rather than an instant. The module comment forbids
  // deciding anything from the application's clock, and this does not break that rule: the ban is
  // on comparing an instant here against an instant the database wrote, which two machines whose
  // clocks disagree would answer differently. This compares two readings taken by THIS process, of
  // its own progress, and asks only "how long have I been unable to confirm my lease" — a question
  // no other machine participates in. `performance.now()` rather than `Date.now()` because it does
  // not step: an NTP correction mid-migration would otherwise expire or extend a claim by accident.
  let leaseConfirmedAt = claimStartedAt;

  // How much of the lease is left to run without a fresh confirmation, asked in one place because
  // two callers need the same answer: the renewal loop, which gives up when it reaches zero, and
  // the shutdown below, which will not wait past it. Two spellings of one formula would agree today
  // and drift the first time the margin moves.
  const leaseRemainingMs = (): number =>
    LOCK_LOSS_AFTER_MS - (performance.now() - leaseConfirmedAt);

  // Only ever one attempt in flight. `setInterval` fires on a schedule, not on completion, so a
  // renewal slower than the interval would otherwise have a second started underneath it — and with
  // a single-connection pool those queue against each other, each making the next later still.
  let renewing = false;

  // The attempt currently in flight, or a settled placeholder when there is none.
  let outstandingRenewal: Promise<unknown> = Promise.resolve();

  const renewal = setInterval(() => {
    // Asked BEFORE attempting, because this is the question the attempt cannot answer: a renewal
    // that never comes back reports nothing at all, and the lease drains while it hangs.
    if (leaseRemainingMs() <= 0) {
      // Reported, and then the attempt below runs ANYWAY. Declaring the loss tells the CALLER it is
      // no longer protected; it does nothing about the callback, which nothing here can stop and
      // which is still writing. Renewal is owner-scoped, so an attempt after a genuine takeover is
      // a no-op that cannot steal the row back — but where the loss came from renewals that could
      // not reach the database, the row is still ours and a later success re-extends the lease over
      // work that never stopped. Giving up entirely is the only option that is strictly worse than
      // both.
      onLost();
    }
    if (renewing) return;
    renewing = true;
    // 🔴 Stamped BEFORE the attempt, and used as the confirmation time if it succeeds. The lease
    // this renewal grants starts when the database runs the statement, which is at or after this
    // instant — so dating the confirmation from here can only UNDERSTATE how much lease is left,
    // which is the safe direction. Reading the clock in the success handler instead dates it from
    // whenever this process next got scheduled, and a pause between the database's read-back and
    // that callback would start a fresh full-length window over a lease that had been ageing
    // throughout it.
    //
    // 🔴 UNVERIFIED by any test, said here rather than left to read as covered. Reproducing it needs
    // the database clock and this process's clock to diverge BETWEEN a renewal's read-back and its
    // callback, which no lever in the double reaches; and the `usable` check above already refuses
    // the large-pause case, so what remains is the narrow band where a lease passes with little
    // surplus and the callback is then delayed past it. The change is kept because its direction is
    // unconditionally safe: an earlier stamp can only shorten this session's own window.
    const attemptStartedAt = performance.now();
    // Kept rather than discarded: a renewal blocked on the connection or the row lock can land long
    // after this session gave up, and its UPDATE re-extends the row whether or not anyone is still
    // waiting for it. The abandonment path below needs to know when that attempt has finished.
    outstandingRenewal = renew(adapter, dialect, claim).then(
      held => {
        renewing = false;
        // Ownership DISPROVED is not a margin question. The row names someone else, so no amount of
        // remaining lease can win it back and the work is already unprotected.
        if (!held) {
          onLost();
          return;
        }
        leaseConfirmedAt = attemptStartedAt;
      },
      () => {
        // An error is not proof the claim is gone — only proof this attempt could not ask. It moves
        // nothing: the confirmation stands where the last success left it, and the elapsed check
        // above is what eventually gives up.
        renewing = false;
      }
    );
    void outstandingRenewal;
  }, LOCK_RENEW_INTERVAL_MS);
  // Never a reason for the process to stay alive: this timer exists to protect work that is already
  // running, so if nothing else is pending there is nothing left to protect.
  renewal.unref?.();

  // Captured rather than returned from inside the `try`, so the lock verification below can run
  // AFTER the release without throwing from a `finally`. A throw there would discard an exception
  // `fn` had already raised — the caller would lose their real failure and be told about the lock
  // instead, which is the hazard `no-unsafe-finally` names.
  let heldToTheEnd = true;
  let result: T;
  let work: Promise<T> | undefined;
  try {
    // Held in its own binding so the abandonment path can wait for it. Its rejection is claimed
    // here as well: when `claimLost` wins the race nothing else is awaiting `work`, and an
    // unobserved rejection there would surface as an unhandled rejection rather than as this
    // session's failure.
    work = fn(session);
    work.catch(() => undefined);
    result = await Promise.race([work, claimLost]);
  } finally {
    // Removed before releasing, so a signal arriving during an orderly release
    // cannot start a second one.
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    // 🔴 Not released once the claim was reported lost. `fn` is still running — nothing here can
    // stop it — so freeing the row would let the next contender start against a database this run
    // is still writing to, which is the precise outcome the lock exists to prevent. Doing nothing
    // is self-correcting: the renewal has stopped, so the claim lapses on its own and the next run
    // takes it over through the ordinary expiry path.
    //
    // 🔴 A release that finds the row already gone REJECTS the run rather than letting the
    // callback's value stand. Completing is not the same as having been protected while completing:
    // the exclusion promises no other run touched these tables meanwhile, and a claim that lapsed
    // or was taken over means that promise was not kept.
    // Shared by both exits below: an attempt that is already in flight has to be allowed to finish
    // before the row is touched, whichever way this session is ending.
    const settle = async (
      pending: Promise<unknown> | undefined
    ): Promise<void> => {
      if (pending !== undefined) await Promise.allSettled([pending]);
    };

    // 🔴 The same wait, BOUNDED, reporting whether it got its answer. A renewal blocked on a
    // connection that never comes back does not reject — it simply never settles — so an unbounded
    // wait here leaves the caller neither resolved nor rejected, which is worse than either outcome
    // this session can report. The bound is what remains of the lease rather than a timeout invented
    // for the occasion: while the claim could still be live, waiting may yet confirm it; once it
    // could not, there is nothing left to confirm and nothing left to protect.
    const settleWithin = (
      pending: Promise<unknown>,
      ms: number
    ): Promise<boolean> => {
      if (ms <= 0) return Promise.resolve(false);
      return new Promise<boolean>(resolve => {
        const deadline = setTimeout(() => resolve(false), ms);
        // Never a reason for the process to stay alive, for the same reason the renewal timer is
        // not: this waits on work that is already finished.
        deadline.unref?.();
        void Promise.allSettled([pending]).then(() => {
          clearTimeout(deadline);
          resolve(true);
        });
      });
    };

    // Clear the row once nothing this session started can still write to it. Shared by the two ways
    // of ending without a confirmed claim, because they need the identical ordering: wait for the
    // callback, since a late extension protects work that is still running; then stop the timer, so
    // no further attempt begins; then wait for whichever attempt was in flight, read after the stop
    // so it is the last one; only then release. Detached, because it may outlive the caller by as
    // long as a blocked renewal takes.
    const clearWhenQuiet = (): void => {
      void (async () => {
        await settle(work);
        clearInterval(renewal);
        await settle(outstandingRenewal);
        await release(adapter, dialect, claim).catch(() => undefined);
      })();
    };

    if (!claimWasLost) {
      clearInterval(renewal);
      // 🔴 The in-flight attempt is settled BEFORE the release, not after. `clearInterval` stops new
      // attempts and does nothing about one already running, and that one is about to read the row
      // this release is clearing — it would see an owner that is no longer this claim, report the
      // claim disproved, and the completion guard below would then fail a migration that held its
      // lock the whole way through and released it itself. A session must not be able to mistake
      // its OWN shutdown for a contender.
      //
      // 🔴 Waiting past the lease would not make the release safer, so it stops there and reports
      // the claim unconfirmed. Releasing anyway would be the worse choice: the stalled attempt can
      // still land afterwards and re-extend a row this session no longer watches. So the release is
      // handed to the quiet-clear below, which waits that attempt out, and the run is failed rather
      // than told it held a lock it could not confirm.
      const confirmed = await settleWithin(
        outstandingRenewal,
        leaseRemainingMs()
      );
      if (confirmed) {
        heldToTheEnd = await release(adapter, dialect, claim);
      } else {
        heldToTheEnd = false;
        clearWhenQuiet();
      }
    } else {
      // 🔴 The row is still not freed HERE, for the reason above — but leaving it entirely alone is
      // not enough either. A renewal already in flight when the claim was abandoned still runs its
      // UPDATE when the connection frees up, re-extending the row by a whole TTL; and because
      // nothing renews it afterwards, the next run sees a live claim owned by a process that gave
      // up, with no way to tell it from a healthy one.
      //
      // So the row is cleared once BOTH the callback and that outstanding attempt have settled.
      // Waiting for the callback is what keeps the original guarantee: while `fn` is still writing,
      // a late extension is protecting it and must stand. Once it has finished, an extended row
      // protects nobody. The release is owner-scoped, so a claim a contender has since taken is
      // left untouched.
      //
      // Detached deliberately: the caller has already been told the claim was lost, and this
      // clean-up may outlive the callback by as long as the blocked renewal takes.
      // 🔴 The timer is NOT stopped here. Renewal keeps running for as long as the callback does,
      // because that is the only thing still able to protect it: the row may well still be ours —
      // a loss declared from renewals that could not reach the database says nothing about who owns
      // it — and a later success re-extends the lease over work that never stopped.
      //
      // Ordering matters in three steps. Wait for the callback, because until it stops, extending
      // is protection rather than a leak. THEN stop the timer, so no further attempt can start.
      // THEN wait for whichever attempt was already in flight, read after the stop so it is the
      // last one, because its UPDATE would otherwise land after the release and leave the row
      // extended with nobody working. Only then clear.
      clearWhenQuiet();
    }
  }

  // Reached only when `fn` RESOLVED — a rejection propagated out of the block above and never gets
  // here, which is the ordering that keeps the caller's own failure primary.
  //
  // `claimWasLost` is decisive HERE without any record of which promise won the race: `claimLost`
  // only ever REJECTS, so it cannot have won and still arrive at this line. Reaching it with the
  // flag set would mean the loss was observed while the callback was finishing, which skips the
  // release for the right reason (work still running when the row stopped being ours) and leaves
  // `heldToTheEnd` at its initial `true` — so without this the run would report success on a claim
  // it had already given up. Completing is not the same as having been protected while completing.
  //
  // 🔴 DEFENSIVE, and currently UNREACHABLE — stated rather than left to read as covered. Loss is
  // declared either by the elapsed check, which runs on a timer callback and therefore cannot
  // interleave into the microtask gap between the race settling and the line below, or by a renewal
  // reporting the row is no longer ours-and-live, which the release then reads the same way and
  // reports through `heldToTheEnd`. No test exercises this branch, because none can reach it. It is
  // kept because reachability is a property of the current call graph rather than of the code: it
  // costs one comparison over a value already in hand, and the invariant it states — never report
  // success on a claim we declared lost — is one the next change to this loop could easily reopen.
  if (claimWasLost) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration lost its lock as it finished; another run may have overlapped it",
      logContext: {
        reason: "migration lock claim was lost before completion",
        label,
      },
    });
  }

  if (!heldToTheEnd && !releasedOnSignal) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration finished without holding its lock; another run may have overlapped it",
      logContext: {
        reason: "migration lock was not held at completion",
        label,
      },
    });
  }
  return result;
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
    // The same pair as the renewal readback, for the same reason: a claim that is ours but already
    // expired is not a claim. Treated as held by whoever the row names — which is this process —
    // because the honest answer is that acquisition did not establish exclusion, not that the row
    // was empty.
    const after = await readLockState(ctx, dialect);
    if (after?.owner !== claim || !after.usable) {
      // 🔴 A refused acquisition must not leave OUR name on the row. The claim UPDATE above has
      // already happened, and returning a result rather than throwing commits it — so without this
      // a run that declined its own claim would still block every contender until the residual
      // lease expired, with nothing renewing it and no callback ever starting. Nobody would even be
      // able to attribute the block: the owner is a UUID belonging to a process that gave up.
      //
      // Cleared rather than rolled back because the adapters reclassify anything thrown out of a
      // transaction callback, which would turn a precise refusal into an opaque database error.
      // Owner-filtered, so a row a contender legitimately took in the meantime is left alone.
      if (after?.owner === claim) {
        await ctx.runStatement(clearClaimStatement(claim));
        return { ok: false, heldBy: null };
      }
      return { ok: false, heldBy: after?.owner ?? null };
    }
    return { ok: true };
  });
}

/**
 * Free the row, but only while we still hold it.
 *
 * Naming the owner as well makes this affect only a row this claim owns, so a late finaliser cannot
 * free a run that has since taken over. Shared by the ordinary release and by the rollback of an
 * acquisition that turned out unusable: those are the same act on the row, and two spellings of it
 * could disagree about the owner filter — which is the half that makes it safe.
 */
function clearClaimStatement(claim: string): SQL {
  return sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
      SET ${sql.identifier("owner")} = NULL,
          ${sql.identifier("expires_at")} = NULL
      WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}
        AND ${sql.identifier("owner")} = ${claim}`;
}

/**
 * Take the lock on a table that predates `expires_at`, using the `owner` column alone.
 *
 * ## Why this exists rather than skipping the lock
 *
 * A caller that may not issue DDL cannot add the missing column, and refusing outright would break
 * every `--no-auto-sync` install that has not yet run a migration under this release. Skipping was
 * the first answer and it is not safe enough: the sync then runs with NO exclusion at all, so a
 * migration that starts during it — or one already in its pre-marker phase, which the marker check
 * cannot see — is free to rename tables underneath work that has already decided what exists.
 *
 * The `owner` column is present on every version of this table, so exclusion does not depend on the
 * new column at all. This claims it, holds it, and clears it, writing no DDL.
 *
 * ## What it gives up, stated rather than glossed
 *
 * No expiry means NO TAKEOVER. An occupied legacy row blocks until an operator clears it, and a
 * process killed mid-run leaves a claim behind. That is not a new hazard introduced here — it is
 * exactly the contract this lock had before `expires_at` existed, and the remedy is the same single
 * migration run that permanently upgrades the row. Exclusion that occasionally needs an operator is
 * a better trade than no exclusion at all, which is what the alternative offered.
 *
 * Nothing renews: there is no lease to extend, so the claim simply stands for the life of the call.
 */
async function acquireOwnerOnly(
  adapter: DrizzleAdapter,
  claim: string
): Promise<Acquisition> {
  return adapter.transaction(async ctx => {
    // The same serialisation the expiry-aware path uses: contenders queue here, so the read below
    // cannot be overtaken between reading and writing.
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);

    const rows = await ctx.queryStatement(ownerOnlyQuery());
    const before = rows[0] as { owner: string | null } | undefined;
    if (before === undefined) return { ok: false, heldBy: null };
    // Any owner blocks, because without an expiry there is no basis on which to judge a claim dead.
    // Guessing would mean stealing the lock from a migration that may still be writing.
    //
    // 🔴 This early return is BELT AND BRACES, not the guard. The `AND "owner" IS NULL` predicate on
    // the UPDATE below is what actually enforces exclusion, and the read-back is what reports it —
    // measured, by removing each in turn: dropping this line alone changes no behaviour and no test,
    // while dropping the predicate lets a held row be overwritten. Said here because the opposite
    // reading is the dangerous one: someone tidying the statement on the strength of this check
    // would remove the only thing enforcing the claim.
    if (before.owner !== null) return { ok: false, heldBy: before.owner };

    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
          SET ${sql.identifier("owner")} = ${claim}
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}
            AND ${sql.identifier("owner")} IS NULL`
    );

    // Read back rather than trusting affected-row counts, which the dialects report inconsistently.
    // Predicating the UPDATE on `owner IS NULL` means a contender that won the race leaves the row
    // naming them, and this is what notices.
    const settled = (await ctx.queryStatement(ownerOnlyQuery()))[0] as
      | { owner: string | null }
      | undefined;
    if (settled?.owner === claim) return { ok: true };
    return { ok: false, heldBy: settled?.owner ?? null };
  });
}

/** The owner, read without touching a column this table may not have. */
function ownerOnlyQuery(): SQL {
  return sql`SELECT ${sql.identifier("owner")}
      FROM ${sql.identifier(MIGRATION_LOCK_TABLE)}
      WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}`;
}

/** Clear an owner-only claim, scoped to this claim so a late finaliser cannot free someone else's. */
async function releaseOwnerOnly(
  adapter: DrizzleAdapter,
  claim: string
): Promise<boolean> {
  return adapter.transaction(async ctx => {
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);
    const before = (await ctx.queryStatement(ownerOnlyQuery()))[0] as
      | { owner: string | null }
      | undefined;
    const heldToTheEnd = before?.owner === claim;
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(MIGRATION_LOCK_TABLE)}
          SET ${sql.identifier("owner")} = NULL
          WHERE ${sql.identifier("id")} = ${LOCK_ROW_ID}
            AND ${sql.identifier("owner")} = ${claim}`
    );
    return heldToTheEnd;
  });
}

/** Release only what we hold, so a late finaliser cannot free someone else's run. */
async function release(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  claim: string
): Promise<boolean> {
  return adapter.transaction(async ctx => {
    await ctx.lockRow(MIGRATION_LOCK_TABLE, LOCK_ROW_ID);
    // 🔴 Read BEFORE clearing, and report it, because the owner-filtered UPDATE below cannot.
    //
    // That statement silently affects nothing when the row has moved on — correct as a release,
    // useless as an ANSWER. A run whose callback finished before a queued renewal reported the
    // takeover reaches here with `claimWasLost` still false, releases nothing, and returns the
    // callback's value as though the work had been protected. This is the last observable moment.
    const before = await readLockState(ctx, dialect);
    const heldToTheEnd = before?.owner === claim && before.live;
    await ctx.runStatement(clearClaimStatement(claim));
    return heldToTheEnd;
  });
}

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
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

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

/** The lock row, addressed the way the adapter's query builder expects. */
function lockRowWhere(owner?: string): WhereClause {
  const and: WhereClause["and"] = [
    { column: "id", op: "=", value: LOCK_ROW_ID },
  ];
  // Naming the owner as well makes a release affect only a row we still hold.
  if (owner !== undefined) {
    and.push({ column: "owner", op: "=", value: owner });
  }
  return { and };
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
  args: { adapter: DrizzleAdapter; dialect: MigrationDialect; label: string },
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

  await ensureLockRow(adapter, dialect);

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

  try {
    return await fn({
      dialect,
      inTransaction: work => adapter.transaction(work),
    });
  } finally {
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

  const existing = await adapter.transaction(async ctx =>
    ctx.selectOne<{ id: number }>(MIGRATION_LOCK_TABLE, {
      where: lockRowWhere(),
    })
  );
  if (existing) return;

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

  const seeded = await adapter.transaction(async ctx =>
    ctx.selectOne<{ id: number }>(MIGRATION_LOCK_TABLE, {
      where: lockRowWhere(),
    })
  );
  if (!seeded) {
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

    const row = await ctx.selectOne<{ owner: string | null }>(
      MIGRATION_LOCK_TABLE,
      { where: lockRowWhere() }
    );

    // Any occupied row refuses, including one that appears to be ours. Claims
    // are unique per invocation, so a match would mean something other than
    // this call wrote it.
    if (row === null || row.owner !== null) {
      return { ok: false, heldBy: row?.owner ?? null };
    }

    await ctx.update(MIGRATION_LOCK_TABLE, { owner: claim }, lockRowWhere());

    // Read back rather than trusting the write. `update` reports affected rows
    // inconsistently across dialects, and an absent row would otherwise update
    // nothing and still look like a successful claim, running the migration
    // with no exclusion at all.
    const after = await ctx.selectOne<{ owner: string | null }>(
      MIGRATION_LOCK_TABLE,
      { where: lockRowWhere() }
    );
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
    await ctx.update(
      MIGRATION_LOCK_TABLE,
      { owner: null },
      lockRowWhere(claim)
    );
  });
}

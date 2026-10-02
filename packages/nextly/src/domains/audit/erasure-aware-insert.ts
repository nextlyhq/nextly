/**
 * Audit domain — writing a row whose identity may already have been erased.
 *
 * Both durable trails face the same race. A row attributed to an account can be
 * written at the moment that account is being deleted: the deletion erases what
 * already exists and a post-commit sweep catches the rest, so a write that lands
 * after both keeps the deleted person's identifiers permanently, with nothing
 * left to key a later erasure on.
 *
 * The decision has to be made INSIDE the write — never as a check followed by a
 * separate insert, which leaves a durable row a second statement was still going
 * to correct. Holding it here keeps the two trails from drifting apart on a
 * question neither can afford to answer differently.
 *
 * @module domains/audit/erasure-aware-insert
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { eq, sql, type Column, type SQL, type Table } from "drizzle-orm";

/**
 * The Drizzle surface an erasure-aware write needs.
 *
 * Structural rather than the concrete types because the real ones are
 * dialect-specific (NodePgDatabase / MySql2Database / BetterSQLite3Database),
 * while the fluent API is identical.
 */
export interface ErasureAwareDb {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): Promise<Record<string, unknown>[]> & {
          // `.for("share")` exists on the Postgres and MySQL builders. SQLite
          // has no row lock and never reaches the call.
          for(strength: "share"): Promise<Record<string, unknown>[]>;
        };
      };
    };
  };
}

/** One row to write, split into the parts erasure does and does not touch. */
export interface ErasureAwareInsert {
  /** The trail being written. Carries the erasure stamp. */
  table: Table & { identityErasedAt: Column };
  /** The accounts table the attribution is checked against. */
  users: Table & { id: Column };
  /** Columns erasure never touches — what happened, and when. */
  row: Record<string, unknown>;
  /**
   * Columns that NAME the person: an address, a client, a display name. Stored
   * as given while the account exists, and NULL once it does not.
   */
  identity?: Record<string, unknown>;
  /**
   * Identity columns whose value comes from the ACCOUNT rather than the caller,
   * as trail column name to accounts column. Read under the same look that
   * decides whether the account exists, so the value stored and the decision to
   * store one cannot disagree.
   */
  identityFromAccount?: Record<string, Column>;
  /**
   * The account this row is attributed to. Null or absent means the row names
   * nobody — a failed sign-in for an address that owns no account, a system
   * write — so there is nothing to erase against and nothing to stamp.
   */
  actorUserId?: string | null;
  /**
   * Columns that may name the actor OR the target — a plugin's metadata, which
   * holds whatever the plugin chose within its declared keys. Stored as given
   * while every account the row names exists, and NULL once either does not,
   * as the deletion of either clears them.
   */
  namesEitherParty?: Record<string, unknown>;
  /**
   * The account this row is about, when it is not the actor's own. Decides
   * {@link namesEitherParty} only: the address and the client belong to the
   * actor.
   */
  targetUserId?: string | null;
}

/** What a write learned that its caller may want to report. */
export interface ErasureAwareOutcome {
  /**
   * The target names no existing account, so {@link
   * ErasureAwareInsert.namesEitherParty} was stored as NULL. False whenever
   * the target decided nothing: no target, no such columns, or the actor.
   */
  targetAbsent: boolean;
}

/**
 * The target whose account decides {@link ErasureAwareInsert.namesEitherParty},
 * or null when no separate target does: the row names none, has no such
 * columns, or is about the actor, whose own look already answers for it.
 */
function decidingTarget(input: ErasureAwareInsert): string | null {
  const { actorUserId, targetUserId } = input;
  if (targetUserId == null || targetUserId === actorUserId) return null;
  return Object.keys(input.namesEitherParty ?? {}).length > 0
    ? targetUserId
    : null;
}

/**
 * Whether a write needs the account rows locked, and so a transaction around
 * it, on Postgres and MySQL. True when the row names an account whose
 * deletion would erase part of it; a row naming nobody is stored as given.
 */
export function erasureNeedsLock(input: ErasureAwareInsert): boolean {
  return input.actorUserId != null || decidingTarget(input) !== null;
}

/**
 * Append one row, deciding what identity it may carry as part of the write.
 *
 * The actor's account decides `identity` and `identityFromAccount`, and the
 * erasure stamp; the actor's and the target's together decide
 * `namesEitherParty`.
 *
 * **Postgres and MySQL** take a SHARED lock on each account row first. The
 * deletion takes an EXCLUSIVE lock before it erases anything, so the two cannot
 * be in flight at once: either this lock is taken first and the deletion waits,
 * so its erasure covers a row that already exists, or the deletion holds the row
 * and this waits for its commit and then correctly finds the account gone. That
 * closes the gap a single statement cannot — its subquery is answered when it
 * STARTS while its row becomes visible when it COMMITS, so an insert spanning
 * the deletion's commit satisfies neither the deletion's erasure nor its sweep.
 * Shared rather than exclusive so concurrent writes naming the same person do
 * not serialise against each other; only the deletion has to exclude them.
 *
 * **SQLite** has one writer, so its insert cannot interleave with the deletion
 * at all and needs no lock. It decides inside the statement instead.
 *
 * The caller owns the transaction. On Postgres and MySQL the lock is only worth
 * anything while one is open, so a caller that has none must supply one.
 *
 * Resolves with whether the target named no account. On SQLite that is read
 * after the insert, since the statement decided it itself; an account cannot
 * reappear, so a target absent then was absent at the insert, or was deleted
 * just after and its deletion cleared the same columns.
 */
export async function insertErasureAware(
  db: ErasureAwareDb,
  dialect: SupportedDialect,
  input: ErasureAwareInsert
): Promise<ErasureAwareOutcome> {
  // A row naming nobody has no account to outlive. Storing an erasure stamp
  // would claim a person was removed from a row that never held one.
  if (!erasureNeedsLock(input)) {
    await db.insert(input.table).values({
      ...input.row,
      ...input.identity,
      ...input.namesEitherParty,
      identityErasedAt: null,
    });
    return { targetAbsent: false };
  }
  if (dialect === "sqlite") {
    await db
      .insert(input.table)
      .values(decidedRow(input, lookInStatement(input)));
    const target = await readAccount(db, input.users, decidingTarget(input), {
      lock: false,
    });
    return { targetAbsent: target.gone };
  }
  const looks = await lookUnderLock(db, input);
  await db.insert(input.table).values(decidedRow(input, looks));
  return { targetAbsent: looks.targetGone === true };
}

/**
 * Whether an account is gone: a boolean read under a lock, or, on SQLite, a
 * condition the insert evaluates itself. `false` for an account the row does
 * not name.
 */
type Gone = boolean | SQL;

/** What the write learned about the accounts the row names. */
interface AccountLooks {
  actorGone: Gone;
  targetGone: Gone;
  /** The actor's own values for `identityFromAccount`, by trail column. */
  fromAccount: Record<string, unknown>;
  /** The stamp to store when the actor is gone. */
  erasedAt: unknown;
}

/**
 * SQLite: decide inside the statement. One writer means the insert cannot
 * interleave with a deletion, so the conditions it evaluates are the answer.
 */
function lookInStatement(input: ErasureAwareInsert): AccountLooks {
  const { users, actorUserId } = input;
  const targetUserId = decidingTarget(input);
  const isGone = (userId: string) =>
    sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${userId})`;
  const fromAccount: Record<string, unknown> = {};
  for (const [column, source] of Object.entries(
    input.identityFromAccount ?? {}
  )) {
    fromAccount[column] =
      actorUserId == null
        ? null
        : sql`(SELECT ${source} FROM ${users} WHERE ${users.id} = ${actorUserId})`;
  }
  return {
    actorGone: actorUserId == null ? false : isGone(actorUserId),
    targetGone: targetUserId == null ? false : isGone(targetUserId),
    fromAccount,
    // Encoded through the column itself: the stamp is an epoch integer here,
    // and an SQL fragment bypasses the mapping Drizzle would otherwise apply.
    erasedAt: input.table.identityErasedAt.mapToDriverValue(new Date()),
  };
}

/**
 * Postgres and MySQL: read each account the row names under a shared lock,
 * which holds the answer for the rest of the caller's transaction.
 */
async function lookUnderLock(
  db: ErasureAwareDb,
  input: ErasureAwareInsert
): Promise<AccountLooks> {
  const { users, actorUserId } = input;
  const fromAccount = input.identityFromAccount ?? {};
  const actor = await readAccount(db, users, actorUserId, {
    lock: true,
    columns: fromAccount,
  });
  // Only a target that decides something is locked: a row with no columns
  // naming either party, or one about the actor, takes no lock on it.
  const target = await readAccount(db, users, decidingTarget(input), {
    lock: true,
  });
  const values: Record<string, unknown> = {};
  for (const column of Object.keys(fromAccount)) {
    values[column] = actor.row?.[column] ?? null;
  }
  return {
    actorGone: actor.gone,
    targetGone: target.gone,
    fromAccount: values,
    // Read AFTER the locks are granted. Acquiring one can wait out a whole
    // deletion, and a stamp taken before the wait would claim the identity
    // was erased at a moment that precedes the deletion it records.
    erasedAt: new Date(),
  };
}

/**
 * Read one account, with the columns asked for, under a shared lock when
 * `lock` is set. An account the row does not name is not gone.
 */
async function readAccount(
  db: ErasureAwareDb,
  users: ErasureAwareInsert["users"],
  userId: string | null | undefined,
  options: { lock: boolean; columns?: Record<string, Column> }
): Promise<{ gone: boolean; row?: Record<string, unknown> }> {
  if (userId == null) return { gone: false };
  const query = db
    .select({ id: users.id, ...options.columns })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [row] = await (options.lock ? query.for("share") : query);
  return { gone: row === undefined, row };
}

/**
 * The row to insert, with each identity column decided by the accounts it
 * names. Under a lock the answers are plain booleans and the values are
 * decided here: deciding them in SQL would need a CASE whose untyped branches
 * Postgres cannot infer a parameter type for.
 */
function decidedRow(
  input: ErasureAwareInsert,
  looks: AccountLooks
): Record<string, unknown> {
  const decided: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(input.identity ?? {})) {
    decided[column] = unlessGone(value, looks.actorGone);
  }
  for (const [column, value] of Object.entries(looks.fromAccount)) {
    decided[column] = unlessGone(value, looks.actorGone);
  }
  const eitherGone = anyGone(looks.actorGone, looks.targetGone);
  for (const [column, value] of Object.entries(input.namesEitherParty ?? {})) {
    decided[column] = unlessGone(value, eitherGone);
  }
  return {
    ...input.row,
    ...decided,
    identityErasedAt: whenGone(looks.erasedAt, looks.actorGone),
  };
}

/** The value while the account exists, NULL once it is gone. */
function unlessGone(value: unknown, gone: Gone): unknown {
  if (gone === false) return value;
  if (gone === true) return null;
  return sql`CASE WHEN ${gone} THEN NULL ELSE ${value} END`;
}

/** The value once the account is gone, NULL while it exists. */
function whenGone(value: unknown, gone: Gone): unknown {
  if (gone === false) return null;
  if (gone === true) return value;
  return sql`CASE WHEN ${gone} THEN ${value} ELSE NULL END`;
}

/** Gone when either account is. */
function anyGone(a: Gone, b: Gone): Gone {
  if (a === true || b === true) return true;
  if (a === false) return b;
  if (b === false) return a;
  return sql`(${a} OR ${b})`;
}

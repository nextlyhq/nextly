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
import { eq, sql, type Column, type Table } from "drizzle-orm";

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
}

/**
 * Append one row, deciding what identity it may carry as part of the write.
 *
 * **Postgres and MySQL** take a SHARED lock on the account row first. The
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
 */
export async function insertErasureAware(
  db: ErasureAwareDb,
  dialect: SupportedDialect,
  input: ErasureAwareInsert
): Promise<void> {
  const { table, users, row, actorUserId } = input;
  const identity = input.identity ?? {};
  const fromAccount = input.identityFromAccount ?? {};

  // A row naming nobody has no account to outlive. Storing an erasure stamp
  // would claim a person was removed from a row that never held one.
  if (actorUserId === undefined || actorUserId === null) {
    await db
      .insert(table)
      .values({ ...row, ...identity, identityErasedAt: null });
    return;
  }

  if (dialect === "sqlite") {
    const now = new Date();
    const actorIsGone = sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${actorUserId})`;
    // Encoded through the column itself: the stamp is an epoch integer here,
    // and an SQL fragment bypasses the mapping Drizzle would otherwise apply.
    const erasedAt = table.identityErasedAt.mapToDriverValue(now);
    const decided: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(identity)) {
      decided[column] =
        sql`CASE WHEN ${actorIsGone} THEN NULL ELSE ${value} END`;
    }
    for (const [column, source] of Object.entries(fromAccount)) {
      decided[column] =
        sql`CASE WHEN ${actorIsGone} THEN NULL ELSE (SELECT ${source} FROM ${users} WHERE ${users.id} = ${actorUserId}) END`;
    }
    await db.insert(table).values({
      ...row,
      ...decided,
      identityErasedAt: sql`CASE WHEN ${actorIsGone} THEN ${erasedAt} ELSE NULL END`,
    });
    return;
  }

  const account = await db
    .select({ id: users.id, ...fromAccount })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1)
    .for("share");
  // Read AFTER the lock is granted. Acquiring it can wait out a whole deletion,
  // and a stamp taken before the wait would claim the identity was erased at a
  // moment that precedes the deletion it records.
  const settled = new Date();
  const stillExists = account.length > 0;
  // Plain values, decided in JS: the lock makes the answer stable for the rest
  // of this transaction. Deciding it in SQL instead would need the same CASE
  // the SQLite path uses, whose untyped branches Postgres cannot infer a
  // parameter type for.
  const decided: Record<string, unknown> = {};
  for (const column of Object.keys(identity)) {
    decided[column] = stillExists ? identity[column] : null;
  }
  for (const column of Object.keys(fromAccount)) {
    decided[column] = stillExists ? (account[0]?.[column] ?? null) : null;
  }
  await db.insert(table).values({
    ...row,
    ...decided,
    identityErasedAt: stillExists ? null : settled,
  });
}

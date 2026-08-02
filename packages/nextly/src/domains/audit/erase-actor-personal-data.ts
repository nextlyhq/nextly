/**
 * Erasing a deleted account's personal data from the audit surfaces, while
 * keeping the audit record itself.
 *
 * Attribution and identity are two different things that happened to share a
 * column. Once they are separated, the audit requirement ("who did this?") and
 * the erasure requirement ("remove this person's data") stop contradicting
 * each other: `user_id` stays as an opaque historical reference so the trail
 * still distinguishes one actor from another, and the name and email that
 * identify the human are removed.
 *
 * This is the single owner of that erasure. Every path that removes an account
 * goes through `UserMutationService.deleteUser`, and `deleteUser` calls this —
 * so a future audit surface is erased by being added here, rather than by every
 * delete path remembering it exists.
 *
 * @module domains/audit/erase-actor-personal-data
 */

import {
  and,
  eq,
  isNotNull,
  isNull,
  or,
  type Column,
  type Table,
} from "drizzle-orm";

/**
 * The Drizzle surface this needs: one scoped UPDATE.
 *
 * Structural rather than the concrete transaction type because the real one is
 * dialect-specific (NodePgTransaction / MySql2Transaction / BetterSQLite3),
 * while the fluent API is identical across all three.
 */
export interface ErasureCapableDb {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/** The audit tables an erasure touches, as the dialect bundle exposes them. */
export interface ErasableAuditTables {
  activityLog: Table & {
    userId: Column;
    userName: Column;
    userEmail: Column;
    identityErasedAt: Column;
  };
}

/**
 * Erase the personal data an account left across the audit surfaces.
 *
 * Runs inside the caller's transaction so it commits with the account removal
 * and rolls back with it. A failure here therefore aborts the deletion, which
 * is deliberate: the invariant worth protecting is that an account is never
 * removed while the data identifying its owner stays behind. The cost is that
 * an installation whose `activity_log` table is missing cannot delete a user
 * until it is provisioned — that describes only the degraded SQLite bootstrap
 * fallback, which already omits half the core tables and is not a working
 * installation.
 *
 * @param db - The caller's open transaction.
 * @param tables - The dialect's table bundle.
 * @param userId - The account being removed.
 * @param erasedAt - When the erasure happened, recorded on every touched row.
 */
export async function eraseActorPersonalData(
  db: ErasureCapableDb,
  tables: ErasableAuditTables,
  userId: string,
  erasedAt: Date
): Promise<void> {
  const { activityLog } = tables;
  await db
    .update(activityLog)
    .set({
      // NULL is the erased state. `identityErasedAt` is what distinguishes it
      // from a row that simply never carried a name, and it records when the
      // erasure happened, which is the evidence an erasure request needs. On
      // this path that is also when the account was deleted, because it runs
      // inside that transaction.
      userName: null,
      userEmail: null,
      identityErasedAt: erasedAt,
    })
    .where(
      and(
        eq(activityLog.userId, userId),
        // Rows already erased are left exactly as they are. This runs more than
        // once per deletion — once inside the transaction and once after it
        // commits, to catch an entry that landed in between — and without this
        // the second pass would rewrite an actor's whole retained history, lock
        // it again, and move every stamp forward to a later time than the
        // erasure it actually records.
        or(
          isNotNull(activityLog.userName),
          isNotNull(activityLog.userEmail),
          isNull(activityLog.identityErasedAt)
        )
      )
    );
}

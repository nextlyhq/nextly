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
  activityLog?: Table & {
    userId: Column;
    userName: Column;
    userEmail: Column;
    identityErasedAt: Column;
  };
  auditLog?: Table & {
    actorUserId: Column;
    ipAddress: Column;
    userAgent: Column;
    identityErasedAt: Column;
  };
}

/**
 * Erase the personal data an account left across the audit surfaces.
 *
 * Runs inside the caller's transaction so it commits with the account removal
 * and rolls back with it. A failure here therefore aborts the deletion, which
 * is deliberate: the invariant worth protecting is that an account is never
 * removed while the data identifying its owner stays behind.
 *
 * Each table is erased only when the caller supplies it, and the caller decides
 * that per table. A table a database does not have holds nothing to erase, so
 * omitting it does not weaken the invariant — while answering for the pair
 * would let one missing table suppress the other's erasure and leave behind
 * exactly what the deletion exists to remove.
 *
 * @param db - The caller's open transaction.
 * @param tables - The dialect's table bundle.
 * @param userId - The account being removed.
 * @param erasedAt - When the erasure happened, recorded on every touched row.
 * @param unstamped - Tables whose database predates the stamp column. Their
 *   identifiers are still erased; only the record of WHEN is unavailable,
 *   because the column to hold it does not exist yet.
 */
export async function eraseActorPersonalData(
  db: ErasureCapableDb,
  tables: ErasableAuditTables,
  userId: string,
  erasedAt: Date,
  unstamped?: ReadonlySet<keyof ErasableAuditTables>
): Promise<void> {
  const { activityLog, auditLog } = tables;
  // Each surface is erased only when the caller supplied it. A database can
  // carry one table and not the other, and the caller decides that per table so
  // a missing one cannot suppress the erasure of the one that is present.
  if (activityLog) {
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

  // The auth log identifies a person by their REQUEST rather than their name:
  // the address they connected from and the client they used. Those are erased
  // for the same reason, while `kind`, the actor and target references, and the
  // timestamp stay — that is the security fact, and it is what a retained trail
  // is for.
  //
  // Keyed on the ACTOR only. `target_user_id` names who an action was performed
  // ON, and the address on such a row belongs to whoever performed it, so
  // erasing by target would scrub a different person's data and leave the
  // subject's own untouched.
  //
  // Rows the deleted account produced WITHOUT attribution — a failed login, a
  // rejected CSRF — are out of reach here by construction, because those are
  // recorded with no actor precisely so a failure cannot reveal which account
  // was reached. Nothing links them to a person, which is also why they are not
  // erasable on request; retention is what bounds them.
  if (auditLog) {
    // A database that predates the stamp column still has to be erased. The
    // stamp records WHEN an erasure happened; the erasure itself is the
    // obligation, and skipping it because the evidence field is missing keeps
    // the identifiers forever — this table carries no cascading key, so nothing
    // else removes the row, and a later migration adds the column without being
    // able to revisit deletions that already happened.
    const stamped = !unstamped?.has("auditLog");
    await db
      .update(auditLog)
      .set({
        ipAddress: null,
        userAgent: null,
        ...(stamped ? { identityErasedAt: erasedAt } : {}),
      })
      .where(
        and(
          eq(auditLog.actorUserId, userId),
          // The stamp cannot be referenced on a schema that lacks it, in the
          // predicate any more than in the assignment.
          stamped
            ? or(
                isNotNull(auditLog.ipAddress),
                isNotNull(auditLog.userAgent),
                isNull(auditLog.identityErasedAt)
              )
            : or(isNotNull(auditLog.ipAddress), isNotNull(auditLog.userAgent))
        )
      );
  }
}

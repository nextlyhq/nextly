/**
 * Removing a person from the delivery log while leaving the log standing.
 *
 * The row answers two different questions that happened to share a column.
 * "How many messages failed last week" belongs to the install and outlives
 * anyone; "was this person written to" belongs to the person and must not.
 * Overwriting `recipient_hash` separates them: the counts, statuses and
 * timestamps survive intact, and the one column that could still name a human
 * stops being able to.
 *
 * This is the single owner of that erasure, for the same reason
 * `domains/audit/erase-actor-personal-data` is the single owner of the audit
 * one — a future delete path is covered by calling this, rather than by
 * remembering the delivery log exists.
 *
 * Deliberately NOT limited to recipients who hold an account. Every recipient
 * gets a row: a password reset to an address that never registered, a CC on a
 * notification, a BCC added by a `beforeSend` filter. Those people can ask to
 * be erased too and no account deletion will ever fire for them, so this takes
 * an ADDRESS rather than a user id.
 *
 * @module domains/email/erase-recipient
 */

import { eq, type Column, type Table } from "drizzle-orm";

import { ERASED_RECIPIENT_HASH, recipientDigest } from "./delivery-record";

/**
 * The Drizzle surface this needs: one scoped UPDATE.
 *
 * Structural rather than the concrete transaction type because the real one is
 * dialect-specific (NodePgTransaction / MySql2Transaction / BetterSQLite3),
 * while the fluent API is identical across all three.
 */
export interface RecipientErasureCapableDb {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/** The delivery table, as a dialect bundle exposes it. */
export type ErasableDeliveriesTable = Table & { recipientHash: Column };

/**
 * Erase every delivery row recorded for an address.
 *
 * Takes the caller's transaction so it commits with whatever else that
 * transaction is doing and rolls back with it. On the account-deletion path
 * that is the point: an account must never be removed while rows that identify
 * its owner stay behind, so a failure here has to take the deletion down rather
 * than leave the two out of step.
 *
 * Matching is by digest, so a row already erased cannot be selected — its
 * stored value is the sentinel, which no address hashes to. Running this twice
 * therefore touches nothing the second time, without needing a guard to say so.
 *
 * Rows written AFTER this returns are untouched and carry a live digest again.
 * That is correct: erasure is a statement about the record as it stands, not a
 * standing instruction to stop recording. Suppressing future rows would require
 * keeping a list of the addresses that asked to be forgotten, which is the
 * opposite of the request.
 *
 * @param db - The caller's open transaction.
 * @param deliveries - The dialect's delivery table.
 * @param address - The recipient, in any form a sender may have written it.
 */
export async function eraseRecipientDeliveries(
  db: RecipientErasureCapableDb,
  deliveries: ErasableDeliveriesTable,
  address: string
): Promise<void> {
  await db
    .update(deliveries)
    .set({ recipientHash: ERASED_RECIPIENT_HASH })
    .where(eq(deliveries.recipientHash, recipientDigest(address)));
}

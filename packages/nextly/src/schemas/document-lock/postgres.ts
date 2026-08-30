/**
 * `nextly_document_lock` — one editor's claim on one document, PostgreSQL.
 *
 * A row exists only while somebody is editing, and says who and until when. Two
 * authors opening the same entry is the case this exists for: without it the
 * second save silently overwrites the first, with nothing recorded anywhere.
 *
 * ## Why the key is synthetic
 *
 * `lock_key` is `collection:entryId` rather than a composite primary key,
 * because the row is claimed through `lockRow`, which takes ONE scalar id. A
 * composite key would need a second way to address the row, and the two would
 * have to agree forever.
 *
 * `collection` and `entry_id` are stored alongside it rather than parsed back
 * out of the key. A `LIKE` against a synthetic key is not an index the database
 * can use, and "who is editing in this collection" is the question an operator
 * actually asks.
 *
 * ## Why the row is small and short-lived
 *
 * `expires_at` is the whole mechanism: a holder that crashes, closes the tab or
 * goes offline stops renewing, and the claim becomes takeable without anybody
 * having to notice it died. Rows are deleted on release and overwritten on
 * re-acquire, so the table's size is bounded by documents being edited right
 * now, not by edits over time.
 *
 * @module schemas/document-lock/postgres
 */

import { index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const nextlyDocumentLock = pgTable(
  "nextly_document_lock",
  {
    // 191 on every dialect, not because PostgreSQL needs it, but because MySQL
    // will not index a longer utf8mb4 varchar. A key that worked on two
    // dialects and threw on the third would surface as an editor that cannot
    // open a document, on one deployment only.
    lockKey: varchar("lock_key", { length: 191 }).primaryKey(),
    collection: varchar("collection", { length: 191 }).notNull(),
    entryId: varchar("entry_id", { length: 191 }).notNull(),
    ownerId: varchar("owner_id", { length: 191 }).notNull(),
    // A snapshot of the holder's display name rather than a join to `users`.
    // The lock is read by every open editor every 15 seconds, so this is a hot
    // path; and the label has to survive the holder being deleted mid-edit,
    // which a join does not. Staleness is bounded by the lease — a rename is
    // visible within one expiry.
    ownerLabel: varchar("owner_label", { length: 191 }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  t => [
    index("ndl_expires_at_idx").on(t.expiresAt),
    index("ndl_collection_idx").on(t.collection),
  ]
);

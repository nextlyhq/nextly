/**
 * `nextly_document_lock` — one editor's claim on one document, PostgreSQL.
 *
 * A row exists only while somebody is editing, and says who, under which
 * acquisition, and until when. Two authors opening the same entry is the case
 * this exists for: without it the second save silently overwrites the first,
 * with nothing recorded anywhere.
 *
 * ## Why `id` is a composite string
 *
 * `id` holds `scopeKind:slug:entryId` rather than the table carrying a
 * composite primary key, because the row is claimed through `lockRow`, whose
 * contract is one scalar keyed on a column literally named `id` — it emits
 * `SELECT id FROM <table> WHERE id = ? FOR UPDATE`.
 *
 * 🔴 The column NAME is part of that contract, not a preference. Called
 * anything else, every claim fails on PostgreSQL and MySQL with
 * `column "id" does not exist` — and passes on SQLite, whose `lockRow` is a
 * no-op because `BEGIN IMMEDIATE` already serializes writers. A single-dialect
 * test run therefore reports this as working.
 *
 * ## Why the scope kind is in the key
 *
 * A collection and a Single may carry the same slug, and their rows live in
 * different tables, so an entry id is unique only within its own kind. Keyed on
 * slug and entry alone, a Single and a collection entry that happened to share
 * both would be one lock: taking over the one would silently release the other.
 *
 * ## Why the row is small and short-lived
 *
 * `expires_at` is the whole mechanism: a holder that crashes, closes the tab or
 * goes offline stops renewing, and the claim becomes takeable without anybody
 * having to notice it died. Rows are deleted on release, overwritten on
 * re-acquire, and swept once expired, so the table's size tracks documents open
 * right now rather than every document ever edited.
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
    id: varchar("id", { length: 191 }).primaryKey(),
    scopeKind: varchar("scope_kind", { length: 32 }).notNull(),
    slug: varchar("slug", { length: 191 }).notNull(),
    entryId: varchar("entry_id", { length: 191 }).notNull(),
    ownerId: varchar("owner_id", { length: 191 }).notNull(),
    // Identifies the ACQUISITION, not the person. One author with the document
    // open in two tabs holds two claims under one `owner_id`; without this, a
    // release from the tab they closed would delete the claim the other tab is
    // still editing under, and that tab would carry on believing it is
    // protected while somebody else takes the document.
    claimToken: varchar("claim_token", { length: 36 }).notNull(),
    // 255 to match the widest `users.name` any dialect stores, so a valid name
    // can never fail an acquisition. Not indexed, so the length costs nothing.
    ownerLabel: varchar("owner_label", { length: 255 }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  t => [
    index("ndl_expires_at_idx").on(t.expiresAt),
    index("ndl_scope_idx").on(t.scopeKind, t.slug),
  ]
);

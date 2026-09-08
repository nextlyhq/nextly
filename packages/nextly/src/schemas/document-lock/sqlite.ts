/**
 * `nextly_document_lock` — one editor's claim on one document, SQLite.
 *
 * See `./postgres.ts` for what the table is, why `id` is a composite string and
 * why the scope kind is part of it.
 *
 * @module schemas/document-lock/sqlite
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const nextlyDocumentLock = sqliteTable(
  "nextly_document_lock",
  {
    id: text("id").primaryKey(),
    scopeKind: text("scope_kind").notNull(),
    slug: text("slug").notNull(),
    entryId: text("entry_id").notNull(),
    ownerId: text("owner_id").notNull(),
    claimToken: text("claim_token").notNull(),
    ownerLabel: text("owner_label"),
    // Stored as unix SECONDS, which is what `mode: "timestamp"` means here and
    // why this dialect's clock expressions are integer arithmetic on
    // `unixepoch()` rather than interval arithmetic.
    acquiredAt: integer("acquired_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  t => [
    index("ndl_expires_at_idx").on(t.expiresAt),
    index("ndl_scope_idx").on(t.scopeKind, t.slug),
  ]
);

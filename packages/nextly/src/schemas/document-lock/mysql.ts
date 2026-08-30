/**
 * `nextly_document_lock` — one editor's claim on one document, MySQL.
 *
 * See `./postgres.ts` for what the table is, why `id` is a composite string and
 * why the scope kind is part of it.
 *
 * @module schemas/document-lock/mysql
 */

import { datetime, index, mysqlTable, varchar } from "drizzle-orm/mysql-core";

export const nextlyDocumentLock = mysqlTable(
  "nextly_document_lock",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    scopeKind: varchar("scope_kind", { length: 32 }).notNull(),
    slug: varchar("slug", { length: 191 }).notNull(),
    entryId: varchar("entry_id", { length: 191 }).notNull(),
    ownerId: varchar("owner_id", { length: 191 }).notNull(),
    claimToken: varchar("claim_token", { length: 36 }).notNull(),
    ownerLabel: varchar("owner_label", { length: 255 }),
    // `datetime` stores no zone, which is why every value written to and read
    // from these two columns comes from `UTC_TIMESTAMP()` rather than `NOW()`.
    // A holder whose session is UTC and a contender whose session is UTC+05
    // would otherwise disagree about when this claim ends by five hours.
    acquiredAt: datetime("acquired_at").notNull(),
    expiresAt: datetime("expires_at").notNull(),
  },
  t => [
    index("ndl_expires_at_idx").on(t.expiresAt),
    index("ndl_scope_idx").on(t.scopeKind, t.slug),
  ]
);

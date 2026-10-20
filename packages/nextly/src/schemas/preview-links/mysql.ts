/**
 * `nextly_preview_links` - MySQL. Mirrors `./postgres.ts`; see it for what each
 * column holds.
 *
 * @module schemas/preview-links/mysql
 */
// fallow-ignore-file code-duplication

import {
  datetime,
  index,
  int,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

import { users } from "../users/mysql";

import type { PreviewLinkDocumentKind } from "./types";

export const nextlyPreviewLinksMysql = mysqlTable(
  "nextly_preview_links",
  {
    id: varchar("id", { length: 64 }).primaryKey(),

    documentKind: varchar("document_kind", { length: 16 })
      .$type<PreviewLinkDocumentKind>()
      .notNull(),
    documentSlug: varchar("document_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 255 }),
    locale: varchar("locale", { length: 64 }),

    // The width of `users.id`, which a foreign key must match.
    createdBy: varchar("created_by", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { fsp: 3 }).notNull(),
    expiresAt: datetime("expires_at", { fsp: 3 }).notNull(),
    generation: int("generation").notNull(),

    revokedAt: datetime("revoked_at", { fsp: 3 }),
    revokedBy: varchar("revoked_by", { length: 191 }).references(
      () => users.id,
      { onDelete: "set null" }
    ),

    openCount: int("open_count").notNull().default(0),
    lastOpenedAt: datetime("last_opened_at", { fsp: 3 }),
  },
  table => [
    index("nextly_preview_links_document_idx").on(
      table.documentKind,
      table.documentSlug,
      table.entryId
    ),
    index("nextly_preview_links_expires_idx").on(table.expiresAt),
    index("nextly_preview_links_created_by_idx").on(table.createdBy),
    index("nextly_preview_links_revoked_by_idx").on(table.revokedBy),
    index("nextly_preview_links_revoked_idx").on(table.revokedAt),
  ]
);

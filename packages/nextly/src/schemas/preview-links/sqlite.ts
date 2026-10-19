/**
 * `nextly_preview_links` - SQLite. Mirrors `./postgres.ts`; see it for what each
 * column holds.
 *
 * @module schemas/preview-links/sqlite
 */
// fallow-ignore-file code-duplication

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

import type { PreviewLinkDocumentKind } from "./types";

export const nextlyPreviewLinksSqlite = sqliteTable(
  "nextly_preview_links",
  {
    id: text("id").primaryKey(),

    documentKind: text("document_kind")
      .$type<PreviewLinkDocumentKind>()
      .notNull(),
    documentSlug: text("document_slug").notNull(),
    entryId: text("entry_id"),
    locale: text("locale"),

    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Seconds, as every timestamp here: the adapter writes a Date as epoch
    // seconds, which is also the precision of the token's `exp`.
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    generation: integer("generation").notNull(),

    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),

    openCount: integer("open_count").notNull().default(0),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp" }),
  },
  table => [
    index("nextly_preview_links_document_idx").on(
      table.documentKind,
      table.documentSlug,
      table.entryId
    ),
    index("nextly_preview_links_expires_idx").on(table.expiresAt),
    index("nextly_preview_links_created_by_idx").on(table.createdBy),
  ]
);

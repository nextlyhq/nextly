/**
 * `nextly_preview_links` - PostgreSQL.
 *
 * One row per preview link minted since links began to be recorded, so a link
 * can be listed, counted and revoked on its own. The token itself is never
 * stored: it is a bearer credential, and a table holding it would hand every
 * reader of the table every live link. The row is found by the token's `jti`,
 * which identifies a link without granting anything.
 *
 * @module schemas/preview-links/postgres
 */
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "../users/postgres";

import type { PreviewLinkDocumentKind } from "./types";

export const nextlyPreviewLinksPg = pgTable(
  "nextly_preview_links",
  {
    // The token's `jti`: 32 hex characters.
    id: varchar("id", { length: 64 }).primaryKey(),

    // The document the link previews. `document_slug` is the collection's slug
    // for an entry and the Single's own slug for a Single; `entry_id` is set
    // for an entry only.
    documentKind: varchar("document_kind", { length: 16 })
      .$type<PreviewLinkDocumentKind>()
      .notNull(),
    documentSlug: varchar("document_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 255 }),
    // The translation the link is limited to, or null for every translation.
    locale: varchar("locale", { length: 64 }),

    // Who made the link. Their rows go with them, as their API keys do: a
    // link renders as its maker, so it cannot outlive them.
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    // What the token's `exp` holds.
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    // The site-wide revocation generation the link was minted under.
    generation: integer("generation").notNull(),

    // Set when this one link is revoked. The revoker may later be deleted;
    // the revocation stands without them.
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),

    // How many times the link itself was opened, not how many pages its
    // session then rendered.
    openCount: integer("open_count").notNull().default(0),
    lastOpenedAt: timestamp("last_opened_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  table => [
    // The live list of one document.
    index("nextly_preview_links_document_idx").on(
      table.documentKind,
      table.documentSlug,
      table.entryId
    ),
    // Retention removes rows long past their end.
    index("nextly_preview_links_expires_idx").on(table.expiresAt),
    // A deleted user's rows, found by the foreign key's own lookup.
    index("nextly_preview_links_created_by_idx").on(table.createdBy),
    // And the rows a deleted user revoked, which the revoker's key clears.
    index("nextly_preview_links_revoked_by_idx").on(table.revokedBy),
    // Retention removes rows long past their revocation too.
    index("nextly_preview_links_revoked_idx").on(table.revokedAt),
  ]
);

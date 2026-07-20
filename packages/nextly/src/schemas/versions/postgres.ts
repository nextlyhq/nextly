/**
 * `nextly_versions` - PostgreSQL.
 *
 * One global content-version store (JSONB snapshot of the assembled document).
 * `id` uses the client-side UUID pattern (text + `$defaultFn`) for cross-dialect
 * parity with the other system tables. Partial unique indexes model the two
 * uniqueness rules; MySQL/SQLite lack partial indexes and enforce them in the
 * repository (mirrors `nextly_schema_events`).
 *
 * @module schemas/versions/postgres
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { VersionScopeKind, VersionStatus } from "./types";

export const nextlyVersionsPg = pgTable(
  "nextly_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),

    // NULL for autosave rows: they never consume the durable sequence.
    versionNo: integer("version_no"),
    status: text("status").$type<VersionStatus>().notNull(),
    isAutosave: boolean("is_autosave").default(false).notNull(),

    snapshot: jsonb("snapshot").notNull(),
    label: text("label"),
    // The locale this snapshot holds. A localized document's snapshot records
    // exactly ONE locale's values, so a restore needs this to know which
    // language to write back into. NULL for an unlocalized document, and on
    // rows captured before this was recorded.
    locale: text("locale"),
    // Restore lineage: the version_no a restore-forward copied from.
    sourceVersionNo: integer("source_version_no"),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    // Moves when the coalesced autosave row is rewritten in place.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    // Durable versions get a unique, monotonic sequence per document.
    uniqueIndex("nextly_versions_seq_uidx")
      .on(table.scopeKind, table.scopeSlug, table.entryId, table.versionNo)
      .where(sql`${table.isAutosave} = false`),
    // Exactly one rolling autosave row per document per user.
    uniqueIndex("nextly_versions_autosave_uidx")
      .on(table.scopeKind, table.scopeSlug, table.entryId, table.createdBy)
      .where(sql`${table.isAutosave} = true`),
    // The only hot read: this document, newest first.
    index("nextly_versions_doc_recent_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId,
      table.createdAt
    ),
  ]
);

export type NextlyVersionPg = typeof nextlyVersionsPg.$inferSelect;
export type NextlyVersionInsertPg = typeof nextlyVersionsPg.$inferInsert;

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
    // Set ONLY on a working draft, to the digest of the four values that
    // identify it (see workingDraftKey). NULL on durable and autosave rows, so
    // the unique index below constrains working drafts alone: all three
    // dialects allow unlimited NULLs in a unique index. The sequence index
    // cannot do this job — a working draft carries no version_no, and NULL is
    // distinct from NULL, so any number of them satisfy it.
    draftKey: text("draft_key"),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    // Moves when the coalesced autosave row is rewritten in place.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    // Monotonic per-row counter, bumped on every in-place rewrite of the
    // coalesced autosave row. This is the compare-and-set token: a writer reads
    // the value, then applies its update only while the row still holds it.
    //
    // `updated_at` cannot serve that purpose across dialects. Its stored
    // resolution varies (SQLite keeps whole seconds, MySQL milliseconds), so
    // two rewrites close enough together serialize to the SAME value and become
    // indistinguishable: the second writer's read observes what the first
    // wrote, its predicate matches, and it overwrites newer work believing the
    // row untouched. A counter has no resolution to run out of.
    //
    // Insert-only rows (durable versions are never rewritten) stay at 0.
    revision: integer("revision").default(0).notNull(),
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
    // One working draft per document per locale.
    uniqueIndex("nextly_versions_working_draft_uidx").on(table.draftKey),
    // The only hot read: this document, newest first.
    index("nextly_versions_doc_recent_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId,
      table.createdAt
    ),
    // The dashboard's pending-edit cards. Column order is the WHERE clause of
    // `findPendingEditRows` followed by its cursor; that function's docblock
    // says why none of the indexes above can serve it.
    index("nextly_versions_pending_edits_idx").on(
      table.isAutosave,
      table.status,
      table.versionNo,
      table.scopeSlug,
      table.updatedAt,
      table.id
    ),
  ]
);

export type NextlyVersionPg = typeof nextlyVersionsPg.$inferSelect;
export type NextlyVersionInsertPg = typeof nextlyVersionsPg.$inferInsert;

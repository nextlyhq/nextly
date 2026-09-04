/**
 * `nextly_versions` - SQLite.
 *
 * See ./postgres.ts for the canonical column list (mirrored with SQLite types).
 * Timestamps are integer epoch seconds (timestamp mode), matching the
 * dynamic tables and the transaction-path Date encoding; JSON columns use
 * text(mode:json); booleans use integer(mode:boolean). No partial unique
 * indexes (drizzle-kit 0.31.10
 * cannot round-trip a SQLite partial index, drizzle-team/drizzle-orm#4688), so
 * uniqueness is enforced in the repository, matching MySQL.
 *
 * @module schemas/versions/sqlite
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { VersionScopeKind, VersionStatus } from "./types";

export const nextlyVersionsSqlite = sqliteTable(
  "nextly_versions",
  {
    // NOT NULL PK: SQLite treats a bare TEXT PRIMARY KEY as nullable, which
    // churns a drizzle-kit rebuild on every push otherwise.
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),

    versionNo: integer("version_no"),
    status: text("status").$type<VersionStatus>().notNull(),
    isAutosave: integer("is_autosave", { mode: "boolean" })
      .default(false)
      .notNull(),

    snapshot: text("snapshot", { mode: "json" }).notNull(),
    label: text("label"),
    locale: text("locale"),
    sourceVersionNo: integer("source_version_no"),
    // Set ONLY on a working draft, to the digest of the four values that
    // identify it (see workingDraftKey). NULL on durable and autosave rows, so
    // the unique index below constrains working drafts alone: all three
    // dialects allow unlimited NULLs in a unique index. The sequence index
    // cannot do this job — a working draft carries no version_no, and NULL is
    // distinct from NULL, so any number of them satisfy it.
    draftKey: text("draft_key"),

    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    // Compare-and-set token for the in-place autosave rewrite. Carries the
    // ordering that `updated_at` cannot here: `mode: "timestamp"` stores whole
    // epoch SECONDS, so two rewrites inside one second are stored identically.
    revision: integer("revision").default(0).notNull(),
  },
  table => [
    // Durable version_no uniqueness per document. A FULL (non-partial) unique
    // index: autosave rows carry a NULL version_no and SQLite allows multiple
    // NULLs in a unique index, so only durable rows are constrained. Postgres
    // expresses this as a partial unique index (WHERE is_autosave = false);
    // SQLite/MySQL cannot, but the NULL tolerance of a full unique index gives
    // the same durable guarantee. Same index name across dialects.
    uniqueIndex("nextly_versions_seq_uidx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId,
      table.versionNo
    ),
    // One working draft per document per locale.
    uniqueIndex("nextly_versions_working_draft_uidx").on(table.draftKey),
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

export type NextlyVersionSqlite = typeof nextlyVersionsSqlite.$inferSelect;
export type NextlyVersionInsertSqlite =
  typeof nextlyVersionsSqlite.$inferInsert;

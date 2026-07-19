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

    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
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
    index("nextly_versions_doc_recent_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId,
      table.createdAt
    ),
  ]
);

export type NextlyVersionSqlite = typeof nextlyVersionsSqlite.$inferSelect;
export type NextlyVersionInsertSqlite =
  typeof nextlyVersionsSqlite.$inferInsert;

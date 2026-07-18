/**
 * `nextly_versions` - SQLite.
 *
 * See ./postgres.ts for the canonical column list (mirrored with SQLite types).
 * Timestamps are integer epoch-ms; JSON columns use text(mode:json); booleans
 * use integer(mode:boolean). No partial unique indexes (drizzle-kit 0.31.10
 * cannot round-trip a SQLite partial index, drizzle-team/drizzle-orm#4688), so
 * uniqueness is enforced in the repository, matching MySQL.
 *
 * @module schemas/versions/sqlite
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
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

/**
 * `nextly_versions` - MySQL.
 *
 * See ./postgres.ts for the canonical column list (mirrored with MySQL types).
 * MySQL has no partial indexes, so the two uniqueness rules (durable-sequence
 * and one-autosave-per-user) are enforced in the repository, not the DB.
 *
 * @module schemas/versions/mysql
 */

import {
  mysqlTable,
  varchar,
  int,
  boolean,
  datetime,
  text,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

import type { VersionScopeKind, VersionStatus } from "./types";

export const nextlyVersionsMysql = mysqlTable(
  "nextly_versions",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: varchar("scope_kind", { length: 32 })
      .$type<VersionScopeKind>()
      .notNull(),
    scopeSlug: varchar("scope_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 36 }).notNull(),

    versionNo: int("version_no"),
    status: varchar("status", { length: 32 }).$type<VersionStatus>().notNull(),
    isAutosave: boolean("is_autosave").default(false).notNull(),

    snapshot: json("snapshot").notNull(),
    label: text("label"),
    locale: varchar("locale", { length: 32 }),
    sourceVersionNo: int("source_version_no"),

    // 191 to match users.id (varchar(191)); created_by holds a user id, which
    // is wider than the 36-char UUID used for this table's own id.
    createdBy: varchar("created_by", { length: 191 }),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    // Durable version_no uniqueness per document. A FULL (non-partial) unique
    // index: autosave rows carry a NULL version_no and MySQL allows multiple
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

export type NextlyVersionMysql = typeof nextlyVersionsMysql.$inferSelect;
export type NextlyVersionInsertMysql = typeof nextlyVersionsMysql.$inferInsert;

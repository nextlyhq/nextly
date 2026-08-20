/**
 * `nextly_releases` and `nextly_release_members` - SQLite.
 *
 * See ./postgres.ts for the canonical column list (mirrored with SQLite types)
 * and for why each index exists. Timestamps are integer epoch values
 * (timestamp mode), matching the dynamic tables and the transaction-path Date
 * encoding.
 *
 * Every index here is a plain one, so the drizzle-kit limitation that stops
 * SQLite carrying a partial index (drizzle-team/drizzle-orm#4688) does not
 * apply: the uniqueness rule is expressed over the `member_key` digest, which
 * is never NULL.
 *
 * @module schemas/releases/sqlite
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { VersionScopeKind } from "../versions/types";

import type { ReleaseMemberAction, ReleaseState } from "./types";

export const nextlyReleasesSqlite = sqliteTable(
  "nextly_releases",
  {
    // NOT NULL PK: SQLite treats a bare TEXT PRIMARY KEY as nullable, which
    // churns a drizzle-kit rebuild on every push otherwise.
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    title: text("title").notNull(),
    description: text("description"),

    scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
    timezone: text("timezone"),

    state: text("state").$type<ReleaseState>().notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }),

    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),

    revision: integer("revision").default(0).notNull(),
  },
  table => [index("nextly_releases_due_idx").on(table.state, table.scheduledAt)]
);

export const nextlyReleaseMembersSqlite = sqliteTable(
  "nextly_release_members",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    releaseId: text("release_id").notNull(),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),
    locale: text("locale"),

    action: text("action").$type<ReleaseMemberAction>().notNull(),

    memberKey: text("member_key").notNull(),

    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_release_members_key_uidx").on(table.memberKey),
    index("nextly_release_members_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId,
      table.locale
    ),
    index("nextly_release_members_release_idx").on(table.releaseId),
  ]
);

export type NextlyReleaseSqlite = typeof nextlyReleasesSqlite.$inferSelect;
export type NextlyReleaseInsertSqlite =
  typeof nextlyReleasesSqlite.$inferInsert;
export type NextlyReleaseMemberSqlite =
  typeof nextlyReleaseMembersSqlite.$inferSelect;
export type NextlyReleaseMemberInsertSqlite =
  typeof nextlyReleaseMembersSqlite.$inferInsert;

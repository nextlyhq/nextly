/**
 * `nextly_releases` and `nextly_release_members` - MySQL.
 *
 * See ./postgres.ts for the canonical column list (mirrored with MySQL types)
 * and for why each index exists. Every index here is a plain one, so MySQL's
 * lack of partial indexes costs nothing: the uniqueness rule is expressed over
 * the `member_key` digest, which is never NULL.
 *
 * @module schemas/releases/mysql
 */

import {
  mysqlTable,
  varchar,
  int,
  datetime,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

import type { VersionScopeKind } from "../versions/types";

import type { ReleaseMemberAction, ReleaseState } from "./types";

export const nextlyReleasesMysql = mysqlTable(
  "nextly_releases",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    scheduledAt: datetime("scheduled_at", { fsp: 3 }),
    timezone: varchar("timezone", { length: 64 }),

    state: varchar("state", { length: 32 }).$type<ReleaseState>().notNull(),
    publishedAt: datetime("published_at", { fsp: 3 }),

    createdBy: varchar("created_by", { length: 36 }),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),

    revision: int("revision").default(0).notNull(),
  },
  table => [index("nextly_releases_due_idx").on(table.state, table.scheduledAt)]
);

export const nextlyReleaseMembersMysql = mysqlTable(
  "nextly_release_members",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    releaseId: varchar("release_id", { length: 36 }).notNull(),

    scopeKind: varchar("scope_kind", { length: 32 })
      .$type<VersionScopeKind>()
      .notNull(),
    scopeSlug: varchar("scope_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 36 }).notNull(),
    locale: varchar("locale", { length: 32 }),

    action: varchar("action", { length: 32 })
      .$type<ReleaseMemberAction>()
      .notNull(),

    // A sha256 hex digest: 64 characters, well inside MySQL's 3072-byte index
    // key limit. A readable composite of the same five values would not be —
    // which is the second reason this column exists.
    memberKey: varchar("member_key", { length: 64 }).notNull(),

    createdBy: varchar("created_by", { length: 36 }),
    createdAt: datetime("created_at", { fsp: 3 })
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

export type NextlyReleaseMysql = typeof nextlyReleasesMysql.$inferSelect;
export type NextlyReleaseInsertMysql = typeof nextlyReleasesMysql.$inferInsert;
export type NextlyReleaseMemberMysql =
  typeof nextlyReleaseMembersMysql.$inferSelect;
export type NextlyReleaseMemberInsertMysql =
  typeof nextlyReleaseMembersMysql.$inferInsert;

/**
 * `nextly_version_views` - MySQL. Mirrors `./postgres.ts`; see it for what
 * each column holds.
 *
 * @module schemas/version-views/mysql
 */
// fallow-ignore-file code-duplication

import {
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import type { VersionScopeKind } from "../versions/types";

export const nextlyVersionViewsMysql = mysqlTable(
  "nextly_version_views",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    userId: varchar("user_id", { length: 255 }).notNull(),

    scopeKind: varchar("scope_kind", { length: 32 })
      .$type<VersionScopeKind>()
      .notNull(),
    scopeSlug: varchar("scope_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 36 }).notNull(),
    part: varchar("part", { length: 35 }),

    // A sha256 hex digest: 64 characters, well inside MySQL's index key limit.
    viewKey: varchar("view_key", { length: 64 }).notNull(),

    versionNo: int("version_no").notNull(),
    previousVersionNo: int("previous_version_no"),
    viewedAt: datetime("viewed_at", { fsp: 3 }).notNull(),
    visitStartedAt: datetime("visit_started_at", { fsp: 3 }).notNull(),

    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_version_views_key_uidx").on(table.viewKey),
    index("nextly_version_views_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId
    ),
    index("nextly_version_views_user_idx").on(table.userId),
  ]
);

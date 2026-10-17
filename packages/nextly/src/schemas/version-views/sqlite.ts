/**
 * `nextly_version_views` - SQLite. Mirrors `./postgres.ts`; see it for what
 * each column holds.
 *
 * @module schemas/version-views/sqlite
 */
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { VersionScopeKind } from "../versions/types";

export const nextlyVersionViewsSqlite = sqliteTable(
  "nextly_version_views",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    userId: text("user_id").notNull(),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),
    part: text("part"),

    viewKey: text("view_key").notNull(),

    versionNo: integer("version_no").notNull(),
    previousVersionNo: integer("previous_version_no"),
    viewedAt: integer("viewed_at", { mode: "timestamp_ms" }).notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
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

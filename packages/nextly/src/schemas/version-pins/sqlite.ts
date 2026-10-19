/**
 * `nextly_version_pins` - SQLite. Mirrors `./postgres.ts`; the parity test
 * holds the column lists in step. Timestamps are integers in timestamp mode,
 * as the other system tables store them.
 *
 * @module schemas/version-pins/sqlite
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

export const nextlyVersionPinsSqlite = sqliteTable(
  "nextly_version_pins",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),

    holder: text("holder").notNull(),
    slot: text("slot").notNull(),

    versionNo: integer("version_no").notNull(),

    pinKey: text("pin_key").notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_version_pins_key_uidx").on(table.pinKey),
    index("nextly_version_pins_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId
    ),
  ]
);

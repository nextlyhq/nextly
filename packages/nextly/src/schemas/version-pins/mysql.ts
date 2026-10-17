/**
 * `nextly_version_pins` - MySQL. Mirrors `./postgres.ts`; the parity test
 * holds the column lists in step.
 *
 * @module schemas/version-pins/mysql
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

export const nextlyVersionPinsMysql = mysqlTable(
  "nextly_version_pins",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: varchar("scope_kind", { length: 32 })
      .$type<VersionScopeKind>()
      .notNull(),
    scopeSlug: varchar("scope_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 36 }).notNull(),

    holder: varchar("holder", { length: 64 }).notNull(),
    slot: varchar("slot", { length: 191 }).notNull(),

    versionNo: int("version_no").notNull(),

    // A sha256 hex digest: 64 characters, well inside MySQL's index key limit,
    // where the readable composite of the five values would not be.
    pinKey: varchar("pin_key", { length: 64 }).notNull(),

    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
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

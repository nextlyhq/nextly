/**
 * `nextly_trash` on MySQL: deleted items, kept until they are restored or
 * removed for good.
 *
 * One row is one trashed item: an entry of a collection, with every row it
 * stored copied into `stored`, or a media file. The item's own rows are gone
 * from their tables while it is here, so no read anywhere can return it.
 *
 * @module schemas/trash/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import {
  boolean,
  datetime,
  json,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import { mysqlIndexes, TRASH_INDEXES } from "../_internal/core-indexes-mysql";

import { TRASH_TABLE } from "./table-name";
import type { TrashedEntry, TrashKind } from "./types";

export const nextlyTrashMysql = mysqlTable(
  TRASH_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // "entry" or "media".
    kind: varchar("kind", { length: 16 }).$type<TrashKind>().notNull(),
    // The collection the entry belonged to. Indexed with `item_id`, so the
    // two stay inside MySQL's index key limit at four bytes a character.
    scopeSlug: varchar("scope_slug", { length: 191 }).notNull(),
    // The item's own id, which a restore gives it back.
    itemId: varchar("item_id", { length: 191 }).notNull(),
    // What a list names the item by: its title, else its slug, when it had one.
    label: text("label"),
    // Every row the item stored, as it stored them.
    stored: json("stored").$type<TrashedEntry>().notNull(),
    // A media file's storage key, and whether trashing made it private.
    storageKey: text("storage_key"),
    madePrivate: boolean("made_private").notNull().default(false),
    // Who trashed it: the kind of caller, its id and its name as they were.
    trashedByKind: varchar("trashed_by_kind", { length: 32 }),
    trashedById: varchar("trashed_by_id", { length: 255 }),
    trashedByName: varchar("trashed_by_name", { length: 255 }),
    // The history event that recorded the entry's deletion, whose life a
    // restore goes on with.
    deletedEventId: varchar("deleted_event_id", { length: 36 }),
    trashedAt: datetime("trashed_at", { fsp: 3 }).notNull(),
    // When it leaves the trash for good, unless restored first.
    purgeAt: datetime("purge_at", { fsp: 3 }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(TRASH_INDEXES, table)
);

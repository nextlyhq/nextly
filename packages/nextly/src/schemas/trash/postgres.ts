/**
 * `nextly_trash` on PostgreSQL: deleted items, kept until they are restored or
 * removed for good.
 *
 * One row is one trashed item: an entry of a collection, with every row it
 * stored copied into `stored`, or a media file. The item's own rows are gone
 * from their tables while it is here, so no read anywhere can return it.
 *
 * @module schemas/trash/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { pgIndexes, TRASH_INDEXES } from "../_internal/core-indexes-postgres";

import { TRASH_TABLE } from "./table-name";
import type { TrashedEntry, TrashKind } from "./types";

export const nextlyTrashPg = pgTable(
  TRASH_TABLE,
  {
    id: text("id").primaryKey(),
    // "entry" or "media".
    kind: text("kind").$type<TrashKind>().notNull(),
    // The collection the entry belonged to.
    scopeSlug: text("scope_slug").notNull(),
    // The item's own id, which a restore gives it back.
    itemId: text("item_id").notNull(),
    // What a list names the item by: its title, else its slug, when it had one.
    label: text("label"),
    // Every row the item stored, as it stored them.
    stored: jsonb("stored").$type<TrashedEntry>().notNull(),
    // A media file's storage key, and whether trashing made it private.
    storageKey: text("storage_key"),
    madePrivate: boolean("made_private").notNull().default(false),
    // Who trashed it: the kind of caller, its id and its name as they were.
    trashedByKind: text("trashed_by_kind"),
    trashedById: text("trashed_by_id"),
    trashedByName: text("trashed_by_name"),
    // The history event that recorded the entry's deletion, whose life a
    // restore goes on with.
    deletedEventId: text("deleted_event_id"),
    trashedAt: timestamp("trashed_at", { withTimezone: true }).notNull(),
    // When it leaves the trash for good, unless restored first.
    purgeAt: timestamp("purge_at", { withTimezone: true }).notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => pgIndexes(TRASH_INDEXES, table)
);

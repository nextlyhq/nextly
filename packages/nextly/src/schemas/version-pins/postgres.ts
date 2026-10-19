/**
 * `nextly_version_pins` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with
 * their own types. A pin is a named slot a feature holds on one document,
 * pointing at one of its versions; retention never removes a version a slot
 * points at.
 *
 * @module schemas/version-pins/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { VersionScopeKind } from "../versions/types";

export const nextlyVersionPinsPg = pgTable(
  "nextly_version_pins",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),

    // The registered feature holding the slot, and the slot's name within it.
    holder: text("holder").notNull(),
    slot: text("slot").notNull(),

    // The version the slot points at. Moving the slot rewrites this, so the
    // version it pointed at before is no longer held by it.
    versionNo: integer("version_no").notNull(),

    // The digest of (document, holder, slot), which the unique index is on —
    // see `versionPinKey`. One slot per document per holder, enforced by the
    // database, with a key short enough for MySQL's index limit.
    pinKey: text("pin_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_version_pins_key_uidx").on(table.pinKey),
    // Retention reads a document's pins on every save.
    index("nextly_version_pins_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId
    ),
  ]
);

/**
 * `nextly_version_views` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with
 * their own types. One row per person, document and part (a language, or the
 * part with none): which versions that person has looked at, by visit, so a
 * comparison can start from "the version you last looked at".
 *
 * @module schemas/version-views/postgres
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

export const nextlyVersionViewsPg = pgTable(
  "nextly_version_views",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // The person who looked. People only: an API key or the system never
    // writes a marker.
    userId: text("user_id").notNull(),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),
    // The part looked at: a language, or null for the part with none.
    part: text("part"),

    // The digest of (person, document, part), which the unique index is on —
    // see `versionViewKey`. A null part cannot sit in a unique index on every
    // dialect, and the readable composite would pass MySQL's key limit.
    viewKey: text("view_key").notNull(),

    // The newest version looked at in the current visit.
    versionNo: integer("version_no").notNull(),
    // The newest version looked at in the visit before it: "the version you
    // last looked at". Null until a second visit.
    previousVersionNo: integer("previous_version_no"),
    // When the person last looked; a look long enough after it starts a new
    // visit.
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull(),
    // When the current visit began: a mark that arrives late, timestamped
    // before it, belongs to the visit before.
    visitStartedAt: timestamp("visit_started_at", {
      withTimezone: true,
    }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_version_views_key_uidx").on(table.viewKey),
    // Removing a document's markers with the document.
    index("nextly_version_views_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId
    ),
    // Removing a person's markers with the person.
    index("nextly_version_views_user_idx").on(table.userId),
  ]
);

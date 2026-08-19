/**
 * `nextly_releases` and `nextly_release_members` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with
 * their own types. `id` uses the client-side UUID pattern (text +
 * `$defaultFn`) for cross-dialect parity with the other system tables.
 *
 * No partial indexes here, unlike `nextly_versions`: every index below is a
 * plain one, so MySQL and SQLite express the same constraints directly instead
 * of falling back to repository enforcement.
 *
 * @module schemas/releases/postgres
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { VersionScopeKind } from "../versions/types";

import type { ReleaseMemberAction, ReleaseState } from "./types";

export const nextlyReleasesPg = pgTable(
  "nextly_releases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    title: text("title").notNull(),
    description: text("description"),

    // NULL while the release is still being assembled: a `draft` release has
    // no time yet, and storing a placeholder would make it indistinguishable
    // from one deliberately scheduled for the epoch.
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    // The IANA zone the author chose the time in, kept for DISPLAY only.
    // `scheduled_at` is the instant and is already absolute; this records that
    // "09:00" meant 09:00 somewhere, which a bare UTC stamp loses.
    timezone: text("timezone"),

    state: text("state").$type<ReleaseState>().notNull(),
    // When materialisation completed, not when it was due. The two differ
    // whenever the reconciler ran late, and only the read rule cares about due.
    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),

    // The compare-and-set token materialisation claims a release with, so two
    // concurrent reconcilers cannot both apply it. A counter rather than
    // `updated_at` for the reason `nextly_versions.revision` gives: stored
    // timestamp resolution varies by dialect, so two writes close together can
    // serialize to the same value and become indistinguishable.
    revision: integer("revision").default(0).notNull(),
  },
  table => [
    // The due-release query reads exactly these two columns together.
    index("nextly_releases_due_idx").on(table.state, table.scheduledAt),
  ]
);

export const nextlyReleaseMembersPg = pgTable(
  "nextly_release_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    releaseId: text("release_id").notNull(),

    scopeKind: text("scope_kind").$type<VersionScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),
    // NULL is the unlocalized document, matching `nextly_versions.locale`.
    locale: text("locale"),

    action: text("action").$type<ReleaseMemberAction>().notNull(),

    // The digest of (release, document, locale) — see `releaseMemberKey`.
    //
    // A plain unique index over the five source columns CANNOT enforce this
    // rule: `locale` is nullable and SQL treats NULL as distinct from NULL, so
    // any number of unlocalized members for one document would satisfy it.
    // `nextly_versions.draft_key` exists for the same reason and is built the
    // same way.
    memberKey: text("member_key").notNull(),

    // Materialisation acts AS this user, so the transition is subject to their
    // permissions and the audit trail names the person who scheduled it rather
    // than a system principal.
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    // One member per document per locale per release.
    uniqueIndex("nextly_release_members_key_uidx").on(table.memberKey),
    // The read-side lookup: given documents, which members mention them.
    index("nextly_release_members_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId,
      table.locale
    ),
    // Listing a release's contents, and cascading a delete.
    index("nextly_release_members_release_idx").on(table.releaseId),
  ]
);

export type NextlyReleasePg = typeof nextlyReleasesPg.$inferSelect;
export type NextlyReleaseInsertPg = typeof nextlyReleasesPg.$inferInsert;
export type NextlyReleaseMemberPg = typeof nextlyReleaseMembersPg.$inferSelect;
export type NextlyReleaseMemberInsertPg =
  typeof nextlyReleaseMembersPg.$inferInsert;

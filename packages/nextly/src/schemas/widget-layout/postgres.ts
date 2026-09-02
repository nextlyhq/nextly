/**
 * `nextly_widget_layout` — one reader's arrangement of the dashboard, PostgreSQL.
 *
 * A row exists only for a scope that has arranged the dashboard at all. Absent,
 * the reader sees the registry's own order, which is exactly today's behaviour
 * — so shipping this table changes nothing for anybody until they move a card.
 *
 * ## Why `id` is a digest
 *
 * `id` holds a sha256 of `scopeKind:scopeId` rather than that string spelled
 * out. The readable form does not fit: this column is `varchar(191)` — the
 * width MySQL will index for a utf8mb4 key — while a user id is itself
 * `varchar(191)` on MySQL and unbounded `text` on PostgreSQL, so `user:` plus
 * an id past 186 characters overruns the key. Those accounts could read the
 * endpoint, because an absent row is a legal answer, and failed on every save.
 *
 * 🔴 Do NOT construct this key by hand. A readable `user:<id>` matches no
 * stored row, so a cleanup query or a migration written from an out-of-date
 * reading of this comment silently affects nothing. `layoutRowId` in
 * `schemas/widget-layout/index.ts` is the one derivation, and every reader,
 * writer and deleter goes through it — which is also what lets the user
 * deletion path address a row without importing the layout service.
 *
 * `scope_kind` and `scope_id` remain as their own readable columns, so an
 * operator can still see whose row this is.
 *
 *
 * ## Why the scope kind is in the key on day one
 *
 * Only `user` rows are written today. The kind is part of the key anyway,
 * because it is half of what identifies an owner: keyed on the reader alone, a
 * second kind of owner added after rows exist means migrating every row to make
 * room for it. The column costs 32 bytes now and removes that migration.
 *
 * ## Why `layout` is `text` and not `jsonb`
 *
 * The `site_settings` convention (`custom_sidebar_groups`, `plugin_placements`),
 * not the `nextly_meta` native-JSON one. A layout is read and written WHOLE —
 * nothing ever queries a JSON path inside it — so native JSON buys nothing, and
 * `jsonb` re-normalizes key order, which this repository has already paid for
 * once in a "has this changed" comparison. A personalization feature invites
 * exactly that comparison (an audit diff, a "your layout vs the team default"
 * view), so the cheap thing to do now is the thing that will not need undoing.
 *
 * ## Why `version` is a column and not a timestamp
 *
 * A whole-document PUT needs to detect that somebody else wrote in between, and
 * two tabs belonging to one person can write in the same second. An integer
 * bumped per write is exact where a timestamp is merely usually right.
 *
 * @module schemas/widget-layout/postgres
 */

import {
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const nextlyWidgetLayout = pgTable("nextly_widget_layout", {
  // 191 on every dialect, not because PostgreSQL needs it, but because MySQL
  // will not index a longer utf8mb4 varchar. Same reasoning, same length, as
  // `nextly_document_lock` — a key that worked on two dialects and threw on the
  // third would surface as a dashboard that cannot be saved, on one deployment
  // only.
  id: varchar("id", { length: 191 }).primaryKey(),
  scopeKind: varchar("scope_kind", { length: 32 }).notNull(),
  // `text`, not `varchar(191)`, and this dialect alone. The KEY is a digest so
  // no scope can overrun it, but this column stores the caller's id verbatim —
  // and PostgreSQL's own `users.id` is unbounded `text`, so an externally
  // supplied id longer than 191 characters would authenticate, read the default
  // layout, and fail on the first save with a length error. Each dialect
  // matches the width its own `users.id` declares; MySQL's is `varchar(191)`,
  // so 191 there is not a limit a real user can reach.
  scopeId: text("scope_id").notNull(),
  // The whole snapshot, as JSON text. `notNull` because a row that exists means
  // somebody arranged something; "no arrangement" is the ABSENCE of a row, and
  // giving it a second spelling here would make two states that read the same.
  layout: text("layout").notNull(),
  // Starts at 1 on the first write, so a client that has never read one sends 0
  // and can be told apart from one holding a real version.
  version: integer("version").notNull().default(1),
  // Written, never read back. It exists for an operator reading the table, not
  // for any code path — which is deliberate: the three dialects disagree about
  // what a timestamp round-trips as, and a column nothing reads cannot be
  // corrupted by that disagreement.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

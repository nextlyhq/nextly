/**
 * `nextly_widget_layout` — one reader's arrangement of the dashboard, PostgreSQL.
 *
 * A row exists only for a scope that has arranged the dashboard at all. Absent,
 * the reader sees the registry's own order, which is exactly today's behaviour
 * — so shipping this table changes nothing for anybody until they move a card.
 *
 * ## Why `id` is a composite string
 *
 * `id` holds `scopeKind:scopeId` rather than the table carrying a composite
 * primary key, matching `schemas/document-lock/postgres.ts`. The layout is
 * always addressed by an exact scope, never scanned by one half of the key, so
 * a composite key would buy nothing a derived string does not already give —
 * and one column is one thing for a future role layer to key on.
 *
 * `scope_kind` is a COLUMN as well as a prefix of the id, so the two halves stay
 * readable to an operator and to any future sweep ("every role default") that
 * has to find rows without knowing their ids.
 *
 * ## Why the scope kind is in the key on day one
 *
 * Only `user` rows are written today; the role layer is designed in and not
 * built (founder, 2026-09-01). Keyed on the reader alone, adding role defaults
 * later would mean migrating every existing row to make room for a second kind
 * of owner. The column costs 32 bytes now and removes a migration later.
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
  scopeId: varchar("scope_id", { length: 191 }).notNull(),
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

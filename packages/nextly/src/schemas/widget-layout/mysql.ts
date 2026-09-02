/**
 * `nextly_widget_layout` — one reader's arrangement of the dashboard, MySQL.
 *
 * See `./postgres` for why the id is composite, why the payload is text rather
 * than native JSON, and why `version` is an integer.
 *
 * @module schemas/widget-layout/mysql
 */

import {
  datetime,
  int,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

export const nextlyWidgetLayout = mysqlTable("nextly_widget_layout", {
  id: varchar("id", { length: 191 }).primaryKey(),
  scopeKind: varchar("scope_kind", { length: 32 }).notNull(),
  scopeId: varchar("scope_id", { length: 191 }).notNull(),
  // MySQL's `TEXT` is 65535 BYTES, where PostgreSQL and SQLite are effectively
  // unbounded. That asymmetry is not academic: a placement carries an opaque
  // `config` the caller fills, so the payload's size is caller-controlled, and
  // without a cap the same write stores cleanly on two dialects and here either
  // errors or — under a permissive `sql_mode` — TRUNCATES, leaving JSON the next
  // read cannot parse and losing the whole saved dashboard on one deployment
  // only. `MAX_LAYOUT_BYTES` in `domains/widgets/layout` is the cap, set to
  // half this limit so multi-byte characters cannot reach it.
  layout: text("layout").notNull(),
  version: int("version").notNull().default(1),
  // `datetime` stores no zone. Nothing reads this column back, so unlike
  // `nextly_document_lock` — whose two clocks have to agree across sessions —
  // there is no comparison here for a session offset to corrupt.
  updatedAt: datetime("updated_at").notNull(),
});

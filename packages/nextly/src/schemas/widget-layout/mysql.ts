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
  mediumtext,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";

export const nextlyWidgetLayout = mysqlTable("nextly_widget_layout", {
  id: varchar("id", { length: 191 }).primaryKey(),
  scopeKind: varchar("scope_kind", { length: 32 }).notNull(),
  scopeId: varchar("scope_id", { length: 191 }).notNull(),
  // `mediumtext` (16 MiB), not `TEXT` (65535 bytes). The narrow type made the
  // column a DECISION SURFACE: a write had to be refused when the payload
  // outgrew it, and that payload is partly made of placements carried on the
  // caller's behalf — so acceptance itself varied with data the caller may not
  // see, and a caller could binary-search a visible placement's size against it
  // to measure hidden configuration. Removing the ceiling removes the oracle by
  // construction, which is a boundary rather than a check for crossings. The
  // caller's own submission is still bounded, by a fixed budget that depends on
  // nothing hidden.
  layout: mediumtext("layout").notNull(),
  version: int("version").notNull().default(1),
  // `datetime` stores no zone. Nothing reads this column back, so unlike
  // `nextly_document_lock` — whose two clocks have to agree across sessions —
  // there is no comparison here for a session offset to corrupt.
  updatedAt: datetime("updated_at").notNull(),
});

/**
 * `nextly_widget_layout` — one reader's arrangement of the dashboard, SQLite.
 *
 * See `./postgres` for why the id is composite, why the payload is text rather
 * than native JSON, and why `version` is an integer.
 *
 * @module schemas/widget-layout/sqlite
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const nextlyWidgetLayout = sqliteTable("nextly_widget_layout", {
  id: text("id").primaryKey(),
  scopeKind: text("scope_kind").notNull(),
  scopeId: text("scope_id").notNull(),
  layout: text("layout").notNull(),
  version: integer("version").notNull().default(1),
  // Unix SECONDS, which is what `mode: "timestamp"` means here. Written, never
  // read back — see `./postgres`.
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

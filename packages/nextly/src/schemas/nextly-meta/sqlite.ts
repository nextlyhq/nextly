/**
 * nextly_meta runtime metadata table — SQLite.
 *
 * Single table: nextlyMeta. See postgres.ts for full documentation.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * @module schemas/nextly-meta/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
} from "drizzle-orm/sqlite-core";

// nextly_meta — runtime key/value flags table.
// Used for state that doesn't belong in collection schemas. First consumer:
// seed.completedAt / seed.skippedAt for the dashboard SeedDemoContentCard.
// See migration 20260504_000000_nextly_meta.sql.
export const nextlyMeta = sqliteTable(
  "nextly_meta",
  {
    key: text("key").primaryKey(),
    value: text("value"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [index("nextly_meta_updated_at_idx").on(t.updatedAt)]
);

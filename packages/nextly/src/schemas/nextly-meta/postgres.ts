/**
 * nextly_meta runtime metadata table — PostgreSQL.
 *
 * Single table: nextlyMeta — runtime key/value flags table.
 * Used for state that doesn't belong in collection schemas. First consumer:
 * seed.completedAt / seed.skippedAt for the dashboard SeedDemoContentCard.
 * See migration 20260504_000000_nextly_meta.sql.
 *
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part
 * of Plan A schemas consolidation. No behavior change.
 *
 * @module schemas/nextly-meta/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// nextly_meta — runtime key/value flags table.
// Used for state that doesn't belong in collection schemas. First consumer:
// seed.completedAt / seed.skippedAt for the dashboard SeedDemoContentCard.
// See migration 20260504_000000_nextly_meta.sql.
export const nextlyMeta = pgTable(
  "nextly_meta",
  {
    key: text("key").primaryKey(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [index("nextly_meta_updated_at_idx").on(t.updatedAt)]
);

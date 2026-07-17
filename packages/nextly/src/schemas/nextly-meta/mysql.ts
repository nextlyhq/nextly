/**
 * nextly_meta runtime metadata table — MySQL.
 *
 * Single table: nextlyMeta. See postgres.ts for full documentation.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * @module schemas/nextly-meta/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  datetime,
  json,
  index,
} from "drizzle-orm/mysql-core";

// nextly_meta — runtime key/value flags table.
// Used for state that doesn't belong in collection schemas. First consumer:
// seed.completedAt / seed.skippedAt for the dashboard SeedDemoContentCard.
// See migration 20260504_000000_nextly_meta.sql.
export const nextlyMeta = mysqlTable(
  "nextly_meta",
  {
    key: varchar("key", { length: 191 }).primaryKey(),
    value: json("value"),
    // DDL-side CURRENT_TIMESTAMP (matching postgres's defaultNow()):
    // a JavaScript `new Date()` default bakes one module-load-time literal
    // into the emitted DDL, so every boot saw a different default and v1's
    // differ emitted MODIFY COLUMN churn forever (the pre-v1 MySQL differ
    // returned empty statement lists and masked this).
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  t => [index("nextly_meta_updated_at_idx").on(t.updatedAt)]
);

/**
 * `nextly_cache_tag_expiries` — when each cache tag last expired, SQLite.
 *
 * See `./postgres.ts` for what each column holds. `expired_at` is an integer
 * of milliseconds, not `mode: "timestamp"` seconds, as on every dialect.
 *
 * @module schemas/cache-tag-expiries/sqlite
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { CACHE_TAG_EXPIRIES_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlyCacheTagExpiries = sqliteTable(
  CACHE_TAG_EXPIRIES_TABLE,
  {
    id: text("id").primaryKey(),
    tag: text("tag").notNull(),
    expiredAt: integer("expired_at").notNull(),
  },
  t => [index("ncte_expired_at_idx").on(t.expiredAt)]
);

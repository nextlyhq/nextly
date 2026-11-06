/**
 * `nextly_cache_tag_expiries` — when each cache tag last expired, MySQL.
 *
 * See `./postgres.ts` for what each column holds.
 *
 * @module schemas/cache-tag-expiries/mysql
 */
import {
  bigint,
  index,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import { CACHE_TAG_EXPIRIES_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlyCacheTagExpiries = mysqlTable(
  CACHE_TAG_EXPIRIES_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tag: text("tag").notNull(),
    expiredAt: bigint("expired_at", { mode: "number" }).notNull(),
  },
  t => [index("ncte_expired_at_idx").on(t.expiredAt)]
);

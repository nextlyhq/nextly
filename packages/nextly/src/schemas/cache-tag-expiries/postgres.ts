/**
 * `nextly_cache_tag_expiries` — when each cache tag last expired, PostgreSQL.
 *
 * One row per tag. A write records the tags it changed here, whichever
 * process made it (a request, a job, the CLI), and every instance's cache
 * handlers read the rows newer than their last look, so an entry stored
 * before its tag expired is not served again on any instance.
 *
 * `id` is the SHA-256 of the tag, in hex: a fixed width every dialect indexes,
 * compared byte for byte whatever collation the database uses. `tag` is the
 * tag itself, which the handlers compare entries' tags against. `expired_at` is
 * milliseconds since the epoch on the database's clock, so instances whose
 * clocks differ agree on what came first. A row is moved forward, never
 * duplicated, when its tag expires again; rows older than the longest cache
 * lifetime are pruned by `expired_at`, which is indexed for that and for the
 * handlers' reads.
 *
 * @module schemas/cache-tag-expiries/postgres
 */
import { bigint, index, pgTable, text, varchar } from "drizzle-orm/pg-core";

import { CACHE_TAG_EXPIRIES_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlyCacheTagExpiries = pgTable(
  CACHE_TAG_EXPIRIES_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tag: text("tag").notNull(),
    expiredAt: bigint("expired_at", { mode: "number" }).notNull(),
  },
  t => [index("ncte_expired_at_idx").on(t.expiredAt)]
);

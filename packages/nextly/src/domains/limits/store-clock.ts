/**
 * The database's clock, in milliseconds, for the database limit store.
 *
 * Every instance times windows and waits on this one clock rather than its
 * own, so two instances whose clocks differ by seconds still agree on when an
 * entry expires. Read in the same statement as the entries it judges.
 *
 * Wall-clock functions, not `now()` / `NOW()`: PostgreSQL freezes `now()` for
 * the whole transaction, and MySQL's `NOW()` is in the session's time zone.
 *
 * @module domains/limits/store-clock
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

/** Milliseconds since the epoch on the database's clock, as a number. */
export function databaseNowMs(dialect: SupportedDialect): SQL<number> {
  switch (dialect) {
    case "postgresql":
      // `bigint` reaches the driver as a string; mapped to a number here so
      // every dialect hands back the same type.
      return sql<number>`floor(extract(epoch from clock_timestamp()) * 1000)::bigint`.mapWith(
        Number
      );
    case "mysql":
      // From UTC_TIMESTAMP rather than UNIX_TIMESTAMP(NOW()), which goes
      // through the session's time zone and is ambiguous across a DST change.
      return sql<number>`CAST(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', UTC_TIMESTAMP(6)) DIV 1000 AS SIGNED)`.mapWith(
        Number
      );
    case "sqlite":
      // `julianday('now')` keeps milliseconds, where `unixepoch()` keeps
      // seconds; rounded, since the day fraction is a float.
      return sql<number>`CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)`.mapWith(
        Number
      );
  }
}

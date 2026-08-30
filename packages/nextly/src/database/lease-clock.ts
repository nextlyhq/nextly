/**
 * The database's own clock, per dialect, and the timings a lease derives from it.
 *
 * Two mechanisms in this package hold a lease: the field-group migration lock, which refuses to
 * steal a live claim because two concurrent migrations corrupt a schema, and the document soft
 * lock, which permits a human to take one over. They disagree about acquisition on purpose. They
 * cannot be allowed to disagree about WHAT TIME IT IS, which is what this module owns.
 *
 * 🔴 Never the application's clock. Contenders sit on different machines — and under serverless,
 * on a different instance per request — whose clocks disagree. A claim written from one clock and
 * judged against another is decided by that skew rather than by who holds the lock. Asking the
 * database for both values puts every comparison in one frame of reference.
 *
 * @module database/lease-clock
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

/**
 * The instant the database is at, as an expression it evaluates itself.
 *
 * SQLite stores these columns as unix SECONDS (the Drizzle declarations use `mode: "timestamp"`),
 * so its expressions are integer arithmetic rather than interval arithmetic.
 */
export function nowExpression(dialect: SupportedDialect): SQL {
  if (dialect === "sqlite") return sql`unixepoch()`;
  // 🔴 PostgreSQL uses `clock_timestamp()`, NOT `now()`, and the difference decides correctness
  // here rather than precision. `now()` is TRANSACTION start time and is frozen for the whole
  // transaction, so a statement that waits on this row — which is exactly what contention means —
  // reads the instant it began queueing rather than the instant it was admitted. A claim judged
  // live by that stale reading can already have expired, and an expiry written from it can be in
  // the past before the row is even updated.
  //
  // 🔴 MySQL uses `UTC_TIMESTAMP()`, NOT `NOW()`. `NOW()` returns the SESSION's local time, and
  // `expires_at` is a `DATETIME`, which stores no zone — so a holder whose session is UTC writes an
  // expiry a contender whose session is UTC+05 reads as five hours in the past, and takes a live
  // claim instantly. Nothing about the row would look wrong afterwards: both runs believe they hold
  // it. `UTC_TIMESTAMP()` is the same instant for every session whatever its `time_zone`.
  //
  // Both are statement-time rather than transaction-time, so neither needs Postgres's distinction.
  return dialect === "mysql" ? sql`UTC_TIMESTAMP()` : sql`clock_timestamp()`;
}

/**
 * `seconds` from now, on the same clock `nowExpression` reads.
 *
 * The pair has to share one frame of reference to mean anything: an expiry written from transaction
 * time and a liveness test taken at statement time would disagree about when the lease ends.
 */
export function futureExpression(
  dialect: SupportedDialect,
  seconds: number
): SQL {
  if (dialect === "sqlite") return sql`unixepoch() + ${seconds}`;
  if (dialect === "mysql") {
    return sql`DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${seconds} SECOND)`;
  }
  return sql`clock_timestamp() + make_interval(secs => ${seconds})`;
}

/**
 * How many seconds remain until `column`, as an expression the database evaluates itself.
 *
 * A DURATION rather than the instant itself, and that is the point. An expiry read back as a value
 * has to be parsed by the driver, and the three drivers disagree: PostgreSQL hands back a `Date`
 * from a `timestamptz`, MySQL a zoneless `DATETIME` the driver interprets in ITS session zone, and
 * SQLite a bare integer of unix seconds that is not a date to anything. Normalising those into one
 * instant is a per-dialect conversion in the read path, which is the same class of bug the
 * expressions above exist to remove from the write path.
 *
 * A remaining span has no such problem. Both sides of the subtraction happen inside one database,
 * on one clock, in one statement, and what crosses the boundary is a number of seconds — the same
 * length in every timebase and on every driver.
 *
 * Negative when the instant has passed, which callers are expected to read as expired rather than
 * clamp: "how long ago" and "not yet" are different answers and only one of them is zero.
 */
export function remainingSecondsExpression(
  dialect: SupportedDialect,
  column: string
): SQL {
  const target = sql.identifier(column);
  if (dialect === "sqlite") return sql`(${target} - unixepoch())`;
  if (dialect === "mysql") {
    return sql`TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), ${target})`;
  }
  return sql`EXTRACT(EPOCH FROM (${target} - clock_timestamp()))`;
}

/** Every timing a lease needs, so a caller cannot hold two of them that disagree. */
export interface LeaseTimings {
  /** How long a confirmation grants. */
  readonly ttlSeconds: number;
  /** How often the holder confirms. */
  readonly renewIntervalMs: number;
  /**
   * How long the holder may go without a CONFIRMED renewal before it must treat the claim as lost.
   *
   * 🔴 Deliberately not "how many renewals failed". A count is only a proxy for the question that
   * decides safety — how much lease is left — and it goes wrong in both directions: retries can
   * overlap, so a stale failure is counted against a lease a later success already extended; and
   * the count reaches its limit at the moment the lease expires rather than before it, so the
   * holder is told after it has stopped being protected rather than while it still is.
   */
  readonly lossAfterMs: number;
  /**
   * How much lease a confirmation must actually grant for the holder to rely on it.
   *
   * 🔴 "Not yet expired" is not the same as "safe to work on". A holder that accepts a renewal
   * leaving almost nothing comes back to a claim that passes a liveness test with nothing left.
   */
  readonly renewMarginSeconds: number;
}

/**
 * Derive every lease timing from the TTL, so no two of them can be chosen independently.
 *
 * 🔴 The derivation is the point. Two numbers picked side by side agree on the day they are written
 * and drift afterwards, silently, because each looks reasonable alone — and the drift here is a
 * holder that believes it is protected while a contender is already taking the row.
 *
 * `renewDivisor` is how many renewals fit in one TTL, and it is the only free parameter. The loss
 * deadline then leaves TWO renewal intervals of lease still in hand, so a holder is told it is
 * losing the claim while it is still protected rather than after.
 */
export function deriveLeaseTimings(
  ttlSeconds: number,
  renewDivisor: number
): LeaseTimings {
  const renewIntervalMs = (ttlSeconds / renewDivisor) * 1000;
  const lossAfterMs = ttlSeconds * 1000 - 2 * renewIntervalMs;
  return {
    ttlSeconds,
    renewIntervalMs,
    lossAfterMs,
    renewMarginSeconds: lossAfterMs / 1000,
  };
}

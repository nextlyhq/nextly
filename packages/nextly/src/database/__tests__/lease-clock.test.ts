import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  deriveLeaseTimings,
  futureExpression,
  nowExpression,
} from "../lease-clock";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/**
 * Two lock mechanisms read this module, and each of the spellings below was a defect once.
 *
 * The expressions are compiled to text rather than compared as objects, because what reaches the
 * database is the rendered SQL and an object comparison would pass on a `sql` template that
 * interpolates something else entirely.
 */
const render = (dialect: SupportedDialect, seconds = 30) => ({
  now: new PgDialect().sqlToQuery(nowExpression(dialect)).sql,
  future: new PgDialect().sqlToQuery(futureExpression(dialect, seconds)).sql,
});

describe("the database clock a lease is judged against", () => {
  it("reads PostgreSQL at STATEMENT time, never transaction time", () => {
    const { now, future } = render("postgresql");
    // `now()` is frozen for the whole transaction, so a statement that waited on a contended row
    // reads the instant it began queueing. A claim judged live by that can already have expired.
    expect(now).toContain("clock_timestamp()");
    expect(now).not.toContain("now()");
    // The pair must share one frame of reference, or the expiry written and the liveness test taken
    // disagree about when the lease ends.
    expect(future).toContain("clock_timestamp()");
  });

  it("reads MySQL on a zone-independent clock", () => {
    const { now, future } = render("mysql");
    // `expires_at` is a zone-less DATETIME. `NOW()` is SESSION-local, so a UTC holder writes an
    // expiry a UTC+05 contender reads as hours past and takes a live claim, with nothing about the
    // row looking wrong afterwards.
    expect(now).toContain("UTC_TIMESTAMP()");
    // Stripping the UTC form first is what stops this matching its own tail.
    expect(now.replace(/UTC_TIMESTAMP\(\)/g, "")).not.toContain("NOW()");
    expect(future.replace(/UTC_TIMESTAMP\(\)/g, "")).not.toContain("NOW()");
  });

  it("reads SQLite as integer seconds", () => {
    const { now, future } = render("sqlite");
    // The Drizzle column is `mode: "timestamp"`, i.e. unix seconds, so the arithmetic is integer
    // rather than interval.
    expect(now).toContain("unixepoch()");
    expect(future).toContain("unixepoch()");
  });

  it("offsets on the same clock it reads, on every dialect", () => {
    // A positive control on the loop below: an empty dialect list would satisfy every assertion in
    // it while checking nothing.
    const dialects: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];
    expect(dialects).toHaveLength(3);

    for (const dialect of dialects) {
      const { now, future } = render(dialect);
      const clockFn = now.match(/[A-Za-z_]+\(\)/)?.[0];
      expect(clockFn, `${dialect} names a clock function`).toBeDefined();
      expect(future, `${dialect} offsets from its own clock`).toContain(
        clockFn as string
      );
    }
  });
});

describe("lease timings", () => {
  it("derives every timing from the TTL", () => {
    // The migration lock's shipped values, which this must reproduce exactly.
    expect(deriveLeaseTimings(120, 8)).toEqual({
      ttlSeconds: 120,
      renewIntervalMs: 15_000,
      lossAfterMs: 90_000,
      renewMarginSeconds: 90,
    });
  });

  it("leaves two renewal intervals of lease in hand at the loss deadline", () => {
    // 🔴 The property, not the arithmetic. A holder must be told it is losing the claim while it is
    // still protected; a deadline that landed ON expiry would tell it afterwards.
    for (const [ttl, divisor] of [
      [120, 8],
      [150, 10],
      [300, 30],
    ] as const) {
      const t = deriveLeaseTimings(ttl, divisor);
      expect(
        t.ttlSeconds * 1000 - t.lossAfterMs,
        `ttl=${ttl} divisor=${divisor}`
      ).toBe(2 * t.renewIntervalMs);
      expect(
        t.lossAfterMs,
        `ttl=${ttl} is protected at its deadline`
      ).toBeLessThan(t.ttlSeconds * 1000);
    }
  });

  it("keeps the margin and the loss deadline in the same units", () => {
    // These are read by different callers — one compares milliseconds, one writes a SQL interval in
    // seconds — and a mismatch here is a lease that looks renewed and is not.
    const t = deriveLeaseTimings(150, 10);
    expect(t.renewMarginSeconds * 1000).toBe(t.lossAfterMs);
  });
});

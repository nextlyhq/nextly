/**
 * Unit tests for `dbTimestampToInstant` — the dialect-aware recovery of the
 * correct instant from a database timestamp `Date`.
 *
 * The assertions are written to be timezone-independent: the naive-dialect
 * inputs are built with the local-parts `Date` constructor (the shape a
 * Postgres/MySQL driver produces for a `timestamp without time zone` /
 * `datetime` column), and the SQLite input is an epoch-correct `Date`. So they
 * pass on a UTC and a non-UTC runner alike, which is exactly the case a fixed
 * offset would hide.
 */
import { describe, it, expect } from "vitest";

import { dbTimestampToInstant } from "../date-formatting";

describe("dbTimestampToInstant", () => {
  it("returns a SQLite epoch Date unchanged (already the correct instant)", () => {
    const epochCorrect = new Date("2026-07-18T12:00:00.000Z");
    const result = dbTimestampToInstant(epochCorrect, "sqlite");
    expect(result.toISOString()).toBe("2026-07-18T12:00:00.000Z");
  });

  it("reinterprets a naive Postgres Date's local fields as UTC", () => {
    // What node-postgres builds for a stored naive "2026-07-18 12:00:00": a Date
    // whose LOCAL calendar fields are those values (local-parts constructor).
    const naiveLocal = new Date(2026, 6, 18, 12, 0, 0);
    const result = dbTimestampToInstant(naiveLocal, "postgresql");
    expect(result.toISOString()).toBe("2026-07-18T12:00:00.000Z");
  });

  it("reinterprets a naive MySQL Date's local fields as UTC", () => {
    const naiveLocal = new Date(2026, 0, 2, 3, 4, 5, 6);
    const result = dbTimestampToInstant(naiveLocal, "mysql");
    expect(result.toISOString()).toBe("2026-01-02T03:04:05.006Z");
  });

  it("passes null through and returns null for an invalid Date", () => {
    expect(dbTimestampToInstant(null, "postgresql")).toBeNull();
    expect(dbTimestampToInstant(new Date("nonsense"), "mysql")).toBeNull();
  });
});

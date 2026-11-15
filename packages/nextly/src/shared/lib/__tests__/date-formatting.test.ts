/**
 * Unit tests for `dbTimestampToInstant` and `normalizeDbTimestamp`: a database
 * timestamp `Date` already names the stored instant, on every dialect.
 *
 * Each adapter decodes a timestamp column to the instant it stored (SQLite
 * epoch seconds, a PostgreSQL wall clock Drizzle reads as UTC, a MySQL one the
 * adapter's UTC session reads as UTC), so the helpers must keep it as it is.
 * Reading its LOCAL calendar fields as UTC instead moves it by the server's
 * offset, which is nothing on a UTC runner, so the cases run under a zone five
 * hours ahead of UTC, where that broken reading fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dbTimestampToInstant, normalizeDbTimestamp } from "../date-formatting";

let previousTz: string | undefined;

beforeEach(() => {
  previousTz = process.env.TZ;
  process.env.TZ = "Asia/Karachi";
});

afterEach(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe("dbTimestampToInstant", () => {
  it("keeps the instant a decoded timestamp names", () => {
    const stored = new Date("2026-07-18T12:00:00.000Z");
    expect(dbTimestampToInstant(stored).toISOString()).toBe(
      "2026-07-18T12:00:00.000Z"
    );
  });

  it("passes null through and returns null for an invalid Date", () => {
    expect(dbTimestampToInstant(null)).toBeNull();
    expect(dbTimestampToInstant(new Date("nonsense"))).toBeNull();
  });
});

describe("normalizeDbTimestamp", () => {
  it("spells a decoded timestamp as the instant it names", () => {
    const stored = new Date("2026-01-02T03:04:05.006Z");
    expect(normalizeDbTimestamp(stored)).toBe("2026-01-02T03:04:05.006Z");
  });

  it("reads a stored wall clock without a zone as UTC", () => {
    expect(normalizeDbTimestamp("2026-01-02 03:04:05")).toBe(
      "2026-01-02T03:04:05Z"
    );
  });

  it("returns null for none or an invalid Date", () => {
    expect(normalizeDbTimestamp(null)).toBeNull();
    expect(normalizeDbTimestamp(new Date("nonsense"))).toBeNull();
  });
});

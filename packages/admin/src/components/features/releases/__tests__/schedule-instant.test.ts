/**
 * That a wall-clock time becomes the instant the editor actually meant.
 *
 * The dangerous case is not a rejected input — it is an ACCEPTED one that means
 * something else. On the day a zone springs forward, the requested hour does not
 * exist, and a solver that returns its nearest approach schedules the launch at
 * a different moment while every screen reads as though it took. Measured before
 * the round-trip check existed: `02:30` in Berlin came back as 03:30 and the
 * same wall time in New York as 01:30 — an hour late and an hour early, from one
 * implementation.
 *
 * @module components/features/releases/__tests__/schedule-instant.test
 */
import { describe, expect, it } from "vitest";

import { instantFor } from "../release-timezone";

/** How an instant reads in a zone, as the oracle rather than as the subject. */
function wallClockIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(iso));
}

describe("instantFor", () => {
  it("returns the instant that reads back as the requested wall time", () => {
    const iso = instantFor("2026-09-01T09:00", "Europe/Berlin");
    expect(iso).not.toBeNull();
    // Asserted through a SEPARATE formatter rather than against a hardcoded
    // UTC string: comparing the function's output to a constant I derived the
    // same way it did would prove only that I repeated its arithmetic.
    expect(wallClockIn(iso as string, "Europe/Berlin")).toContain("09:00");
  });

  it("refuses a wall time the zone SKIPS, rather than moving the launch", () => {
    // 02:30 does not exist in Berlin on 2026-03-29: the clocks go 02:00 → 03:00.
    expect(instantFor("2026-03-29T02:30", "Europe/Berlin")).toBeNull();
  });

  it("refuses it in the other direction too", () => {
    // The same shape in a zone that springs forward on a different date, and it
    // used to fail the OPPOSITE way — an hour early rather than an hour late.
    // One case could be satisfied by a solver that always rounds one way.
    expect(instantFor("2026-03-08T02:30", "America/New_York")).toBeNull();
  });

  it("accepts the hour just after a gap", () => {
    // The control on the two above: the rejection must be about the missing
    // hour, not about that DATE. Without this, a check that refused every
    // transition day would pass both cases above.
    const iso = instantFor("2026-03-29T03:30", "Europe/Berlin");
    expect(iso).not.toBeNull();
    expect(wallClockIn(iso as string, "Europe/Berlin")).toContain("03:30");
  });

  it("accepts an AMBIGUOUS wall time at its FIRST occurrence", () => {
    // On a fall back, 02:30 happens twice — in Berlin on this date, 00:30Z
    // (CEST) and 01:30Z (CET) both read as 02:30. Both are real instants, so
    // refusing would reject a time an editor can legitimately name; the earlier
    // is what "02:30 that day" means, and the input cannot express the other.
    //
    // The exact instant is asserted rather than the rendered time, because BOTH
    // candidates render as 02:30 — a round-trip assertion cannot tell them
    // apart, and an earlier version of this test passed while returning the
    // later one.
    expect(instantFor("2026-10-25T02:30", "Europe/Berlin")).toBe(
      "2026-10-25T00:30:00.000Z"
    );
  });

  it("picks the first occurrence in a second zone, on its own date", () => {
    // A control on the case above. One ambiguous case is satisfied by an
    // implementation that happens to subtract the standard-time offset; a zone
    // whose transition falls on a different date and at a different UTC hour is
    // not.
    expect(instantFor("2026-11-01T01:30", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z"
    );
  });

  it("resolves a zone whose offset is not a whole hour", () => {
    // Kolkata is UTC+5:30 year-round. A solver working in whole hours produces
    // a plausible-looking instant thirty minutes out, and the round trip is
    // what catches it.
    const iso = instantFor("2026-01-15T12:00", "Asia/Kolkata");
    expect(iso).toBe("2026-01-15T06:30:00.000Z");
    expect(wallClockIn(iso as string, "Asia/Kolkata")).toContain("12:00");
  });

  it("says nothing for an unparseable wall time", () => {
    expect(instantFor("not-a-time", "Europe/Berlin")).toBeNull();
  });
});

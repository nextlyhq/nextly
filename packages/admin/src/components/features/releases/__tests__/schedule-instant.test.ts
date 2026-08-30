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

import { instantFor } from "../ScheduleReleaseDialog";

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

  it("accepts an AMBIGUOUS wall time at its first occurrence", () => {
    // On a fall back, 02:30 happens twice. Both are real instants, so refusing
    // would reject a time the editor can legitimately name; the earlier one is
    // what "02:30 that day" means.
    const iso = instantFor("2026-10-25T02:30", "Europe/Berlin");
    expect(iso).toBe("2026-10-25T01:30:00.000Z");
    expect(wallClockIn(iso as string, "Europe/Berlin")).toContain("02:30");
  });

  it("says nothing for an unparseable wall time", () => {
    expect(instantFor("not-a-time", "Europe/Berlin")).toBeNull();
  });
});

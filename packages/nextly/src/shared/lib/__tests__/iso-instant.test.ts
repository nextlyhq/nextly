/**
 * The one strict reading of ISO 8601 instants: the shape first, then the
 * calendar day the string states.
 */
import { describe, expect, it } from "vitest";

import { readIsoDateOrInstant, readIsoInstant } from "../iso-instant";

function at(reading: ReturnType<typeof readIsoInstant>): string {
  if (!reading.ok) throw new Error(reading.problem);
  return reading.at.toISOString();
}

describe("readIsoInstant", () => {
  it("reads an instant with Z or an offset, with or without seconds and milliseconds", () => {
    expect(at(readIsoInstant("2026-09-01T09:00Z"))).toBe(
      "2026-09-01T09:00:00.000Z"
    );
    expect(at(readIsoInstant("2026-09-01T09:00:00.000Z"))).toBe(
      "2026-09-01T09:00:00.000Z"
    );
    // East of Greenwich, just after midnight: August 31 in UTC, and valid.
    expect(at(readIsoInstant("2026-09-01T00:30:00+02:00"))).toBe(
      "2026-08-31T22:30:00.000Z"
    );
  });

  it("refuses a bare date, a time with no zone, and anything else", () => {
    for (const raw of [
      "2026-09-01",
      "2026-09-01T09:00:00",
      "1",
      "09/01/2026",
      "",
    ]) {
      expect(readIsoInstant(raw), raw).toEqual({ ok: false, problem: "shape" });
    }
  });

  it("refuses a well-formed date that does not exist, in the offset it states", () => {
    expect(readIsoInstant("2026-02-30T09:00:00Z")).toEqual({
      ok: false,
      problem: "no-such-day",
    });
    expect(readIsoInstant("2026-02-29T23:30:00-02:00")).toEqual({
      ok: false,
      problem: "no-such-day",
    });
  });

  it("refuses the right shape holding no instant", () => {
    expect(readIsoInstant("2026-09-01T25:00:00Z")).toEqual({
      ok: false,
      problem: "invalid",
    });
  });
});

describe("readIsoDateOrInstant", () => {
  it("reads a bare date as the start of that day in UTC", () => {
    expect(at(readIsoDateOrInstant("2026-09-01"))).toBe(
      "2026-09-01T00:00:00.000Z"
    );
  });

  it("reads an instant exactly as readIsoInstant does", () => {
    expect(at(readIsoDateOrInstant("2026-09-01T00:30:00+02:00"))).toBe(
      "2026-08-31T22:30:00.000Z"
    );
  });

  it("refuses a bare date that does not exist, and a time with no zone", () => {
    expect(readIsoDateOrInstant("2026-02-30")).toEqual({
      ok: false,
      problem: "no-such-day",
    });
    expect(readIsoDateOrInstant("2026-09-01T09:00:00")).toEqual({
      ok: false,
      problem: "shape",
    });
  });
});

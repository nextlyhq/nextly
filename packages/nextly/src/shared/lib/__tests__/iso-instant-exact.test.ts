/**
 * The exact reading of an ISO 8601 instant: whole seconds and the digits of a second as written,
 * and why a text is not one, telling a text that names no time or no offset from one that is no
 * date at all.
 */
import { describe, expect, it } from "vitest";

import { readExactIsoInstant } from "../iso-instant";

describe("readExactIsoInstant", () => {
  it("keeps every digit of a second up to microseconds, at its offset", () => {
    expect(readExactIsoInstant("2026-06-30T23:30:00.123456-01:00")).toEqual({
      ok: true,
      instant: {
        seconds: Date.UTC(2026, 6, 1, 0, 30, 0) / 1000,
        fraction: "123456",
      },
    });
  });

  it("reads a time with no seconds, and one with no fraction", () => {
    expect(readExactIsoInstant("2026-01-02T03:04Z")).toEqual({
      ok: true,
      instant: { seconds: Date.UTC(2026, 0, 2, 3, 4, 0) / 1000, fraction: "" },
    });
  });

  it("says a date names no time, and a date and time name no offset", () => {
    expect(readExactIsoInstant("2026-01-02")).toEqual({
      ok: false,
      problem: "no-time",
    });
    expect(readExactIsoInstant("2026-01-02T03:04:05")).toEqual({
      ok: false,
      problem: "no-offset",
    });
  });

  it("finds a day that does not exist whatever else the text lacks", () => {
    expect(readExactIsoInstant("2026-02-30")).toEqual({
      ok: false,
      problem: "no-such-day",
    });
    expect(readExactIsoInstant("2026-02-30T00:00:00Z")).toEqual({
      ok: false,
      problem: "no-such-day",
    });
  });

  it("takes only the accepted separators and offsets, and at most six digits of a second", () => {
    for (const text of [
      "2026-01-02 03:04:05Z",
      "2026-01-02T03:04:05z",
      "2026-01-02T03:04:05,5Z",
      "2026-01-02T03:04:05+0100",
      "2026-01-02T03:04:05.1234567Z",
    ]) {
      expect(readExactIsoInstant(text)).toEqual({
        ok: false,
        problem: "shape",
      });
    }
  });
});

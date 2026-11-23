import { describe, expect, it } from "vitest";

import { expiryFor } from "./expiry";

describe("a link's expiry, as an email says it", () => {
  it("is written in the site's time zone, beside the instant itself", () => {
    expect(
      expiryFor(new Date("2026-11-30T12:00:00.000Z"), "Asia/Karachi")
    ).toEqual({
      expiresAt: "2026-11-30T12:00:00.000Z",
      expiresAtText: "30 November 2026, 5:00 PM",
      timeZone: "Asia/Karachi",
    });
  });

  it("crosses midnight into the zone's own date, and writes midnight as 12 AM", () => {
    expect(
      expiryFor(new Date("2026-11-30T19:00:00.000Z"), "Asia/Karachi")
        .expiresAtText
    ).toBe("1 December 2026, 12:00 AM");
    expect(
      expiryFor(new Date("2026-11-30T19:05:00.000Z"), "UTC").expiresAtText
    ).toBe("30 November 2026, 7:05 PM");
  });
});

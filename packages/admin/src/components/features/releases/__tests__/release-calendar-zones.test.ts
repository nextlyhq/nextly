/**
 * The zones the calendar offers, and how each one is named.
 *
 * The reader's own zone first, as the list reads times in it; then the zones
 * the releases on screen were scheduled in, which are the ones this page has
 * a reason to offer; then every other zone the platform knows.
 *
 * @module components/features/releases/__tests__/release-calendar-zones.test
 */
import { describe, expect, it } from "vitest";

import { calendarZoneGroups, zoneOffsetLabel } from "../release-calendar-zones";

const SUPPORTED = [
  "America/New_York",
  "Asia/Karachi",
  "Europe/Berlin",
  "Pacific/Auckland",
  "UTC",
];

describe("calendarZoneGroups", () => {
  it("offers the reader's zone, then the scheduled zones, then the rest, each zone once", () => {
    const groups = calendarZoneGroups({
      reader: "Europe/Berlin",
      current: "Europe/Berlin",
      scheduled: ["Asia/Karachi", "Europe/Berlin", "Asia/Karachi", "UTC"],
      supported: SUPPORTED,
    });
    expect(groups).toEqual([
      { id: "reader", label: "Your time zone", zones: ["Europe/Berlin"] },
      {
        id: "scheduled",
        label: "Scheduled in",
        zones: ["Asia/Karachi", "UTC"],
      },
      {
        id: "all",
        label: "All time zones",
        zones: ["America/New_York", "Pacific/Auckland"],
      },
    ]);
  });

  it("leaves out the scheduled group when every release is in the reader's zone", () => {
    const groups = calendarZoneGroups({
      reader: "UTC",
      current: "UTC",
      scheduled: ["UTC"],
      supported: SUPPORTED,
    });
    expect(groups.map(group => group.id)).toEqual(["reader", "all"]);
  });

  it("still offers the zone being shown when the platform's list lacks it", () => {
    // `Intl.supportedValuesOf` is missing on some runtimes, and an alias such
    // as Asia/Calcutta is valid but not listed. The zone on screen must stay
    // choosable, or the control would show a value it cannot select.
    const groups = calendarZoneGroups({
      reader: "UTC",
      current: "Asia/Calcutta",
      scheduled: [],
      supported: [],
    });
    expect(groups.flatMap(group => group.zones)).toEqual([
      "UTC",
      "Asia/Calcutta",
    ]);
  });

  it("always offers UTC, which the platform's own list can leave out", () => {
    // Chromium and Node list no "UTC" among `Intl.supportedValuesOf`'s
    // zones, so a reader outside UTC could otherwise never choose it.
    const groups = calendarZoneGroups({
      reader: "Asia/Karachi",
      current: "Asia/Karachi",
      scheduled: [],
      supported: ["America/New_York", "Asia/Karachi"],
    });
    expect(groups.find(group => group.id === "all")?.zones).toContain("UTC");
    // Once, wherever else it already is.
    const asReader = calendarZoneGroups({
      reader: "UTC",
      current: "UTC",
      scheduled: ["UTC"],
      supported: ["UTC"],
    });
    expect(
      asReader.flatMap(group => group.zones).filter(zone => zone === "UTC")
    ).toHaveLength(1);
  });

  it("drops a scheduled zone the platform cannot read", () => {
    const groups = calendarZoneGroups({
      reader: "UTC",
      current: "UTC",
      scheduled: ["Not/AZone", "Asia/Karachi"],
      supported: SUPPORTED,
    });
    expect(groups.find(group => group.id === "scheduled")?.zones).toEqual([
      "Asia/Karachi",
    ]);
  });
});

describe("zoneOffsetLabel", () => {
  it("names the offset the zone runs at on that date", () => {
    // Berlin is an hour ahead in winter and two in summer, so the label is
    // read for the month shown rather than fixed.
    expect(
      zoneOffsetLabel("Europe/Berlin", new Date("2026-01-15T12:00:00Z"))
    ).toBe("GMT+1");
    expect(
      zoneOffsetLabel("Europe/Berlin", new Date("2026-07-15T12:00:00Z"))
    ).toBe("GMT+2");
    expect(
      zoneOffsetLabel("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))
    ).toBe("GMT+5:30");
  });
});

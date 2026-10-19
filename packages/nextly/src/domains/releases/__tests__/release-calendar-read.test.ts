/**
 * The calendar's counts and the releases it shows come from one read.
 *
 * Two reads of a window can disagree: the drain publishing a release between
 * them leaves a day counting it as scheduled while its chip says published.
 * The separating property is that the rows shown are the rows counted, which
 * a fake table whose release moves on every read makes observable: two reads
 * see two different states, one read sees one.
 *
 * @module domains/releases/__tests__/release-calendar-read.test
 */
import { describe, expect, it, vi } from "vitest";

import { zonedDays } from "../release-calendar";
import { ReleasesRepository, type ReleasesDbApi } from "../releases-repository";

/** A table holding one release that the drain publishes after every read. */
function movingTable() {
  let state: "scheduled" | "published" = "scheduled";
  const select = vi.fn(async () => {
    const row = {
      id: "r1",
      title: "Launch",
      description: null,
      scheduledAt: new Date("2027-05-04T09:00:00Z"),
      publishedAt:
        state === "published" ? new Date("2027-05-04T09:00:05Z") : null,
      timezone: "UTC",
      state,
      kind: "release",
      createdBy: null,
      createdAt: new Date("2027-05-01T00:00:00Z"),
      updatedAt: new Date("2027-05-01T00:00:00Z"),
      revision: 0,
    };
    state = "published";
    return [row];
  });
  return { db: { select } as unknown as ReleasesDbApi, select };
}

describe("the calendar's read", () => {
  it("counts the very rows it shows, from one read of the window", async () => {
    const { db, select } = movingTable();
    const repo = new ReleasesRepository(db);

    const [day] = await repo.findReleaseCalendar({
      days: zonedDays({
        from: "2027-05-04",
        to: "2027-05-04",
        timezone: "UTC",
      }),
      perDay: 3,
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(day.releases).toHaveLength(1);
    // The state the chip shows is the state the day counted.
    expect(day.counts[day.releases[0].state]).toBe(1);
    expect(day.total).toBe(1);
  });
});

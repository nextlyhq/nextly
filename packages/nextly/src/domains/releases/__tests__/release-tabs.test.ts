/**
 * The tab rule evaluated in memory, at the edge where precision matters.
 *
 * SQLite stores instants in whole seconds and truncates a bound parameter to
 * one, so a cutoff with a fractional second is not the cutoff the database
 * compares against. The in-memory check must judge a release in that second
 * the same way the database does, or `isReleaseOverdue` and the attention tab
 * disagree about it.
 *
 * @module domains/releases/__tests__/release-tabs.test
 */
import { describe, expect, it } from "vitest";

import {
  overdueCutoff,
  RELEASE_OVERDUE_AFTER_MS,
  releaseTabOf,
} from "../release-tabs";
import type { ReleaseRow } from "../releases-repository";

const scheduledAt = (at: Date): ReleaseRow => ({
  id: "r1",
  title: "Launch",
  description: null,
  scheduledAt: at,
  timezone: "UTC",
  state: "scheduled",
  kind: "release",
  publishedAt: null,
  createdBy: null,
  createdAt: at,
  updatedAt: at,
  revision: 0,
});

describe("the overdue cutoff", () => {
  it("is a whole second, so every dialect compares against the same instant", () => {
    const now = new Date("2026-10-16T09:00:00.750Z");
    expect(overdueCutoff(now).getMilliseconds()).toBe(0);
    expect(overdueCutoff(now).getTime()).toBe(
      new Date("2026-10-16T08:50:00.000Z").getTime()
    );
  });

  it("keeps a release stored in the cutoff's own second in Upcoming, as SQLite does", () => {
    // `now` has a fractional second; the release is stored in the cutoff's
    // second (SQLite keeps no milliseconds). The database reads them as equal,
    // so `>= cutoff` holds and the release is Upcoming.
    const now = new Date("2026-10-16T09:00:00.750Z");
    const storedInThatSecond = new Date(
      Math.floor((now.getTime() - RELEASE_OVERDUE_AFTER_MS) / 1000) * 1000
    );
    expect(releaseTabOf(scheduledAt(storedInThatSecond), now)).toBe("upcoming");
    // The control: a second earlier is overdue, so the rule is not simply
    // calling everything upcoming.
    expect(
      releaseTabOf(
        scheduledAt(new Date(storedInThatSecond.getTime() - 1000)),
        now
      )
    ).toBe("attention");
  });
});

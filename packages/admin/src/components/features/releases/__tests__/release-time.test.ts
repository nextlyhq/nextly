/**
 * How a release's instant reads to a reader in one zone, when it was
 * scheduled in another.
 *
 * Each case names a reader's zone and a scheduled zone explicitly, so the
 * suite says the same thing on any machine whatever its own zone is.
 *
 * @module components/features/releases/__tests__/release-time.test
 */
import { describe, expect, it } from "vitest";

import {
  relativeTime,
  releaseTimeOfDay,
  releaseTimeSentence,
  releaseTimeText,
} from "../release-time";

/**
 * ICU puts a narrow no-break space before AM/PM in some versions and a plain
 * space in others; the reader sees a space either way.
 */
function plain(text: string | null | undefined): string | null | undefined {
  return text?.replace(/ /g, " ");
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("releaseTimeText", () => {
  it("shows one time when the reader is in the zone it was scheduled in", () => {
    const text = releaseTimeText("2026-10-17T04:00:00.000Z", {
      readerZone: "Asia/Karachi",
      scheduledZone: "Asia/Karachi",
      now: Date.parse("2026-10-14T04:00:00.000Z"),
    });
    expect(plain(text?.local)).toBe("Sat, Oct 17, 2026 9:00 AM");
    expect(text?.relative).toBe("in 3 days");
    expect(text?.scheduled).toBeNull();
  });

  it("adds the scheduled zone's time, with its date, when the two clocks are on different days", () => {
    // 02:00 UTC is 22:00 the evening before in New York, and 07:00 in Karachi.
    const text = releaseTimeText("2026-10-17T02:00:00.000Z", {
      readerZone: "America/New_York",
      scheduledZone: "Asia/Karachi",
      now: Date.parse("2026-10-14T02:00:00.000Z"),
    });
    expect(plain(text?.local)).toBe("Fri, Oct 16, 2026 10:00 PM");
    expect(text?.scheduled?.zone).toBe("Asia/Karachi");
    expect(plain(text?.scheduled?.text)).toBe("Sat, Oct 17, 2026 7:00 AM");
    expect(plain(text ? releaseTimeSentence(text) : null)).toBe(
      "Fri, Oct 16, 2026 10:00 PM your time · Sat, Oct 17, 2026 7:00 AM Asia/Karachi (as scheduled)"
    );
  });

  it("gives only the scheduled zone's time when both clocks are on the same day", () => {
    const text = releaseTimeText("2026-10-17T04:00:00.000Z", {
      readerZone: "Europe/London",
      scheduledZone: "Asia/Karachi",
      now: 0,
    });
    expect(plain(text?.local)).toBe("Sat, Oct 17, 2026 5:00 AM");
    expect(plain(text?.scheduled?.text)).toBe("9:00 AM");
  });

  it("judges 'different' by the clock, not by the zone's name", () => {
    // London keeps UTC's clock in January: two names, one reading. Naming the
    // scheduled zone here would print the same time twice under two labels.
    const text = releaseTimeText("2026-01-15T09:00:00.000Z", {
      readerZone: "UTC",
      scheduledZone: "Europe/London",
      now: 0,
    });
    expect(plain(text?.local)).toBe("Thu, Jan 15, 2026 9:00 AM");
    expect(text?.scheduled).toBeNull();
  });

  it("converts across a week when only one of the two zones has changed its clocks", () => {
    // New York moved to summer time on 8 March 2026 and Berlin not until
    // 29 March, so for those three weeks they are five hours apart, not six.
    const text = releaseTimeText("2026-03-20T13:00:00.000Z", {
      readerZone: "Europe/Berlin",
      scheduledZone: "America/New_York",
      now: 0,
    });
    expect(plain(text?.local)).toBe("Fri, Mar 20, 2026 2:00 PM");
    expect(plain(text?.scheduled?.text)).toBe("9:00 AM");
  });

  it("never labels a time with a zone it could not format in", () => {
    const text = releaseTimeText("2026-10-17T04:00:00.000Z", {
      readerZone: "Asia/Karachi",
      scheduledZone: "Mars/Olympus_Mons",
      now: 0,
    });
    expect(plain(text?.local)).toBe("Sat, Oct 17, 2026 9:00 AM");
    expect(text?.scheduled).toBeNull();
  });

  it("reads an unusable reader zone as UTC rather than guessing", () => {
    const text = releaseTimeText("2026-10-17T04:00:00.000Z", {
      readerZone: "Nowhere/Special",
      scheduledZone: "UTC",
      now: 0,
    });
    expect(plain(text?.local)).toBe("Sat, Oct 17, 2026 4:00 AM");
    expect(text?.scheduled).toBeNull();
  });

  it("answers null for no instant, and for one that does not parse", () => {
    const context = { readerZone: "UTC", scheduledZone: "UTC", now: 0 };
    expect(releaseTimeText(null, context)).toBeNull();
    expect(releaseTimeText("not a date", context)).toBeNull();
  });

  it("says the sentence as just the local time when there is no second zone", () => {
    const text = releaseTimeText("2026-10-17T04:00:00.000Z", {
      readerZone: "UTC",
      now: 0,
    });
    expect(plain(text ? releaseTimeSentence(text) : null)).toBe(
      "Sat, Oct 17, 2026 4:00 AM"
    );
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-14T12:00:00.000Z");

  it("counts forward and back in the largest unit that fits", () => {
    expect(relativeTime(now + 3 * DAY, now)).toBe("in 3 days");
    expect(relativeTime(now - 2 * HOUR, now)).toBe("2 hours ago");
    expect(relativeTime(now + 22 * DAY, now)).toBe("in 3 weeks");
    expect(relativeTime(now + 25 * 60_000, now)).toBe("in 25 minutes");
  });

  it("says a day as a count, never as 'tomorrow'", () => {
    // Thirty hours from 23:00 is the day after tomorrow on the calendar, so a
    // calendar word here would name the wrong day.
    expect(relativeTime(now + 30 * HOUR, now)).toBe("in 1 day");
  });

  it("has words for under a minute either side of now", () => {
    expect(relativeTime(now + 20_000, now)).toBe("in under a minute");
    expect(relativeTime(now - 20_000, now)).toBe("just now");
  });
});

describe("releaseTimeOfDay", () => {
  it("reads the clock in the zone it is given, not the reader's", () => {
    // One instant, two clocks: 02:00 UTC is 22:00 the evening before in New
    // York and 07:00 in Karachi. A calendar drawn in either zone must say its
    // own clock's time on the chip.
    expect(
      plain(releaseTimeOfDay("2026-10-17T02:00:00.000Z", "America/New_York"))
    ).toBe("10:00 PM");
    expect(
      plain(releaseTimeOfDay("2026-10-17T02:00:00.000Z", "Asia/Karachi"))
    ).toBe("7:00 AM");
  });

  it("says nothing for no instant, or a zone it cannot honour", () => {
    // Never the reader's own time under another zone's name.
    expect(releaseTimeOfDay(null, "UTC")).toBeNull();
    expect(
      releaseTimeOfDay("2026-10-17T02:00:00.000Z", "Not/AZone")
    ).toBeNull();
  });
});

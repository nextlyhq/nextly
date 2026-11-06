/**
 * The rules behind scheduling one document, without React: the release's
 * name, the time the dialog opens on, and the control focus goes back to.
 *
 * @module components/features/releases/__tests__/schedule-publish.test
 */
import { describe, expect, it } from "vitest";

import { dialogOpenerOf } from "../dialog-opener";
import {
  defaultScheduleWall,
  scheduledReleaseTitle,
  scheduleTimeProblem,
} from "../schedule-publish";

describe("the release's name", () => {
  it("is the document's title", () => {
    expect(scheduledReleaseTitle("  Spring launch ")).toBe("Spring launch");
  });

  it("is Untitled for a document with none", () => {
    expect(scheduledReleaseTitle(undefined)).toBe("Untitled");
    expect(scheduledReleaseTitle("   ")).toBe("Untitled");
  });

  it("fits the 255 characters the server takes", () => {
    const named = scheduledReleaseTitle("a".repeat(300));
    expect(named).toHaveLength(255);
    expect(named.endsWith("…")).toBe(true);
  });

  it("never splits a character the 255 limit falls inside", () => {
    // The limit falls between the emoji's two UTF-16 halves: kept, the first
    // half alone is not a character, and the server stores a broken name.
    const named = scheduledReleaseTitle(
      `${"a".repeat(253)}😀${"b".repeat(10)}`
    );
    expect(named).toBe(`${"a".repeat(253)}…`);
    expect(LONE_SURROGATE.test(named)).toBe(false);
  });

  it("never splits a character built from several, such as a family", () => {
    // Eight UTF-16 units, three people joined: cut inside, it names fewer.
    const family = "👨‍👩‍👧";
    const named = scheduledReleaseTitle(`${"a".repeat(250)}${family}zzz`);
    expect(named).toBe(`${"a".repeat(250)}…`);
  });

  it("keeps a character that fits whole", () => {
    const named = scheduledReleaseTitle(
      `${"a".repeat(252)}😀${"b".repeat(10)}`
    );
    expect(named).toBe(`${"a".repeat(252)}😀…`);
    expect(named).toHaveLength(255);
  });
});

/** Half of a UTF-16 pair with its other half missing. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("the time the dialog opens on", () => {
  it("is nine tomorrow on the chosen zone's clock", () => {
    // 23:30 in UTC is already the next day in Tokyo.
    const now = Date.parse("2026-10-30T23:30:00Z");
    expect(defaultScheduleWall(now, "UTC")).toBe("2026-10-31T09:00");
    expect(defaultScheduleWall(now, "Asia/Tokyo")).toBe("2026-11-01T09:00");
  });

  it("is tomorrow on a night the clocks go back", () => {
    // 00:30 on 1 November 2026 in New York, before the clocks go back at
    // 02:00: that day is 25 hours long, so 24 hours on is still the 1st.
    const now = Date.parse("2026-11-01T04:30:00Z");
    expect(defaultScheduleWall(now, "America/New_York")).toBe(
      "2026-11-02T09:00"
    );
  });

  it("is tomorrow on a night the clocks go forward", () => {
    // 23:30 on 7 March 2026 in New York: the 8th is 23 hours long.
    const now = Date.parse("2026-03-08T04:30:00Z");
    expect(defaultScheduleWall(now, "America/New_York")).toBe(
      "2026-03-08T09:00"
    );
  });

  it("rolls over a month and a year end", () => {
    expect(defaultScheduleWall(Date.parse("2026-12-31T12:00:00Z"), "UTC")).toBe(
      "2027-01-01T09:00"
    );
  });
});

describe("a time's problem", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  it("is none for a time still to come", () => {
    expect(
      scheduleTimeProblem("2026-10-30T13:00", "2026-10-30T13:00:00.000Z", now)
    ).toBeNull();
  });
  it("is that it passed, at the very moment too", () => {
    expect(
      scheduleTimeProblem("2026-10-30T12:00", "2026-10-30T12:00:00.000Z", now)
    ).toBe("passed");
  });
});

describe("where focus goes back to", () => {
  it("is a menu's trigger for a dialog opened from one of its rows", () => {
    document.body.innerHTML = `
      <button id="trigger">More ways to publish</button>
      <div role="menu" aria-labelledby="trigger">
        <div role="menuitem" tabindex="-1" id="row">Schedule publish…</div>
      </div>`;
    expect(dialogOpenerOf(document.getElementById("row"))?.id).toBe("trigger");
  });

  it("is the control itself for anything else", () => {
    document.body.innerHTML = `<button id="panel">Schedule publish…</button>`;
    expect(dialogOpenerOf(document.getElementById("panel"))?.id).toBe("panel");
  });
});

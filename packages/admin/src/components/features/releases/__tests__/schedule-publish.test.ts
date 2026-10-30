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
});

describe("the time the dialog opens on", () => {
  it("is nine tomorrow on the chosen zone's clock", () => {
    // 23:30 in UTC is already the next day in Tokyo.
    const now = Date.parse("2026-10-30T23:30:00Z");
    expect(defaultScheduleWall(now, "UTC")).toBe("2026-10-31T09:00");
    expect(defaultScheduleWall(now, "Asia/Tokyo")).toBe("2026-11-01T09:00");
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

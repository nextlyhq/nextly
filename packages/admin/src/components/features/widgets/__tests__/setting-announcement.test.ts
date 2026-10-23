/**
 * What the grid says when a card's setting changes outside customise mode: that it is set, when
 * the card shows it, and that it is saved but not yet on the card, when the card's new answer was
 * refused and it still shows the earlier one.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useGridAnnouncer } from "../useGridAnnouncer";

/** What the live region reads, without the invisible mark that makes a repeat re-read. */
const spoken = (announcement: string) =>
  announcement.replace(/\u200b/g, "").trim();

/** The announcer with nothing settling, so only what it is told to say is said. */
function announcer() {
  return renderHook(() => useGridAnnouncer(false, 0, 0));
}

describe("announcing a card's changed setting", () => {
  it("says the setting is set when the card shows it", () => {
    const { result } = announcer();
    act(() =>
      result.current.announceSettingChanged(
        "Activity",
        "Date range",
        "Last 30 days",
        true
      )
    );
    expect(spoken(result.current.announcement)).toBe(
      "Activity: Date range set to Last 30 days."
    );
  });

  it("says it is saved, and the card still shows its earlier data, when the answer was refused", () => {
    const { result } = announcer();
    act(() =>
      result.current.announceSettingChanged(
        "Activity",
        "Date range",
        "Last 30 days",
        false
      )
    );
    expect(spoken(result.current.announcement)).toBe(
      "Activity: Date range saved as Last 30 days, but the card could not load it and still shows the earlier data."
    );
  });
});

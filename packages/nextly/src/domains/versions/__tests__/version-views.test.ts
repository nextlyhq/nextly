/**
 * The visit rule for "the version you last looked at": marks that arrive out
 * of order join the visit they belong to and move no time backwards.
 */
import { describe, expect, it } from "vitest";

import { VISIT_GAP_MS, lastLookedAt, nextMarker } from "../version-views";

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 9, 17, 9) + minutes * 60_000);

describe("nextMarker", () => {
  it("moves forward within a visit, and starts a new one after the gap", () => {
    let marker = nextMarker(undefined, 3, at(0));
    marker = nextMarker(marker, 1, at(5));
    expect(marker).toMatchObject({ versionNo: 3, previousVersionNo: null });
    marker = nextMarker(marker, 2, at(5 + VISIT_GAP_MS / 60_000));
    expect(marker).toMatchObject({ versionNo: 2, previousVersionNo: 3 });
    expect(marker.visitStartedAt).toEqual(at(5 + VISIT_GAP_MS / 60_000));
  });

  it("folds a late mark into the current visit without moving its time back", () => {
    const marker = nextMarker(nextMarker(undefined, 5, at(0)), 6, at(10));
    // Timestamped at 5, inside the visit that began at 0, arriving after 10.
    const late = nextMarker(marker, 9, at(5));
    expect(late).toMatchObject({ versionNo: 9, previousVersionNo: null });
    expect(late.viewedAt).toEqual(at(10));
  });

  it("gives a late mark from before the current visit to the previous visit", () => {
    // Visit one ends at v8; v5 starts visit two at 40 minutes.
    const first = nextMarker(undefined, 8, at(0));
    const second = nextMarker(first, 5, at(40));
    expect(second).toMatchObject({ versionNo: 5, previousVersionNo: 8 });
    // A delayed v10 from visit one (timestamp 2) arrives now.
    const late = nextMarker(second, 10, at(2));
    expect(late).toMatchObject({ versionNo: 5, previousVersionNo: 10 });
    expect(late.viewedAt).toEqual(at(40));
    // Visit two's furthest stays v5; "last looked at" is visit one's, v10.
    expect(lastLookedAt(late, at(45))).toBe(10);
    expect(lastLookedAt(late, at(40 + 31))).toBe(5);
  });
});

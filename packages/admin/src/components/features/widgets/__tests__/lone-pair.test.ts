/**
 * The pair that shares a row of the default dashboard: the one of Needs attention and Upcoming
 * releases on show is drawn across the row while the other is not, and nothing else moves.
 */
import { describe, expect, it } from "vitest";

import { widenLoneOfPair, widensLonePair } from "../lone-pair";

const ATTENTION = "core/needs-attention";
const RELEASES = "core/upcoming-releases";

/** A row of the default dashboard: a widget at its stored size. */
const row = (id: string, w: number, h = 4) => ({
  placementId: id,
  widget: { id },
  size: { w, h },
});

/** The default's first rows: the pair, then Continue and Content. */
const rows = () => [
  row(ATTENTION, 8),
  row(RELEASES, 4),
  row("core/continue", 6),
  row("core/content", 6),
];

type Row = ReturnType<typeof row>;

/** Each row as `[widget, the width it is drawn at]`, in order, by the rule over `given`. */
const drawnAs = (given: readonly Row[], isOnShow: (row: Row) => boolean) => {
  const widened = widenLoneOfPair(given, isOnShow);
  return given.map(each => [
    each.widget.id,
    widened.get(each.placementId) ?? each.size.w,
  ]);
};

describe("the pair that shares a row", () => {
  it("draws Needs attention across the row while Upcoming releases is not on show", () => {
    expect(drawnAs(rows(), each => each.widget.id !== RELEASES)).toEqual([
      [ATTENTION, 12],
      [RELEASES, 4],
      ["core/continue", 6],
      ["core/content", 6],
    ]);
  });

  it("draws Upcoming releases across the row while Needs attention is not on show", () => {
    expect(drawnAs(rows(), each => each.widget.id !== ATTENTION)).toEqual([
      [ATTENTION, 8],
      [RELEASES, 12],
      ["core/continue", 6],
      ["core/content", 6],
    ]);
  });

  it("draws the one on the dashboard across the row when the other is not on it at all", () => {
    // Not shown to this reader: the layout read leaves the card out of their placements.
    const drawn = drawnAs(
      rows().filter(each => each.widget.id !== RELEASES),
      () => true
    );
    expect(drawn[0]).toEqual([ATTENTION, 12]);
  });

  it("keeps each at its own size while both are on show, handing the same empty answer back", () => {
    const given = rows();
    const widened = widenLoneOfPair(given, () => true);
    expect(widened.size).toBe(0);
    // The same answer each time, so a caller memoising on it redraws nothing.
    expect(widenLoneOfPair(rows(), () => true)).toBe(widened);
  });

  it("widens nothing while neither is on show", () => {
    expect(
      widenLoneOfPair(
        rows(),
        each => each.widget.id !== ATTENTION && each.widget.id !== RELEASES
      ).size
    ).toBe(0);
  });

  it("widens no other card standing alone, and changes no height", () => {
    // The control: a lone card outside the pair keeps its width, so the rule is the pair's.
    const given = [row("core/continue", 6), row(RELEASES, 4, 5)];
    expect([...widenLoneOfPair(given, () => true)]).toEqual([[RELEASES, 12]]);
    // The stored rows are left as they were: the width is drawn, never written back.
    expect(given.map(each => each.size)).toEqual([
      { w: 6, h: 4 },
      { w: 4, h: 5 },
    ]);
  });
});

describe("whether a dashboard widens the lone card of the pair", () => {
  it("does where the reader follows a default that gives the pair a row of their own", () => {
    expect(widensLonePair({ arranged: false, pairedRow: true })).toBe(true);
  });

  it("does not where the default places the two otherwise, or a server says nothing", () => {
    expect(widensLonePair({ arranged: false, pairedRow: false })).toBe(false);
    expect(widensLonePair({ arranged: false })).toBe(false);
  });

  it("does not on a dashboard the reader arranged, nor before the layout is read", () => {
    expect(widensLonePair({ arranged: true, pairedRow: true })).toBe(false);
    expect(widensLonePair(undefined)).toBe(false);
  });
});

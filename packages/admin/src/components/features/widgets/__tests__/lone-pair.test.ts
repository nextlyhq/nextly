/**
 * The pair that shares a row of the default dashboard: the one of Needs attention and Upcoming
 * releases on show is drawn across the row while the other is not, and nothing else moves.
 */
import { describe, expect, it } from "vitest";

import { widenLoneOfPair } from "../lone-pair";

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

/** Each row as `[widget, w]`, in order. */
const widths = (drawn: ReadonlyArray<ReturnType<typeof row>>) =>
  drawn.map(each => [each.widget.id, each.size.w]);

describe("the pair that shares a row", () => {
  it("draws Needs attention across the row while Upcoming releases is not on show", () => {
    const drawn = widenLoneOfPair(rows(), each => each.widget.id !== RELEASES);
    expect(widths(drawn)).toEqual([
      [ATTENTION, 12],
      [RELEASES, 4],
      ["core/continue", 6],
      ["core/content", 6],
    ]);
  });

  it("draws Upcoming releases across the row while Needs attention is not on show", () => {
    const drawn = widenLoneOfPair(rows(), each => each.widget.id !== ATTENTION);
    expect(widths(drawn)).toEqual([
      [ATTENTION, 8],
      [RELEASES, 12],
      ["core/continue", 6],
      ["core/content", 6],
    ]);
  });

  it("draws the one on the dashboard across the row when the other is not on it at all", () => {
    // Not shown to this reader: the layout read leaves the card out of their placements.
    const drawn = widenLoneOfPair(
      rows().filter(each => each.widget.id !== RELEASES),
      () => true
    );
    expect(widths(drawn)[0]).toEqual([ATTENTION, 12]);
  });

  it("keeps each at its own size while both are on show, handing the same rows back", () => {
    const given = rows();
    const drawn = widenLoneOfPair(given, () => true);
    expect(drawn).toBe(given);
    expect(widths(drawn)).toEqual(widths(rows()));
  });

  it("widens nothing while neither is on show", () => {
    const given = rows();
    expect(
      widenLoneOfPair(
        given,
        each => each.widget.id !== ATTENTION && each.widget.id !== RELEASES
      )
    ).toBe(given);
  });

  it("widens no other card standing alone, and changes no height", () => {
    // The control: a lone card outside the pair keeps its width, so the rule is the pair's.
    const given = [row("core/continue", 6), row(RELEASES, 4, 5)];
    const drawn = widenLoneOfPair(given, () => true);
    expect(drawn.map(each => each.size)).toEqual([
      { w: 6, h: 4 },
      { w: 12, h: 5 },
    ]);
    // The stored rows are left as they were: the width is drawn, never written back.
    expect(given[1].size).toEqual({ w: 4, h: 5 });
  });
});

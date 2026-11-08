/**
 * Which cards may stand at their content's height: only those whose band of rows, the cards whose
 * rows overlap as the grid places them, all start on one row and span as many. The cells' half,
 * drawn in the grid, is in `WidgetGrid.test.tsx`.
 */
import { describe, expect, it } from "vitest";

import { contentSizedPlacements, type BandCard } from "../row-bands";

const card = (id: string, span: number, rows: number): BandCard => ({
  id,
  span,
  rows,
});

/** The placements that may fit, sorted, with nothing drawn off its stored rows. */
const fitting = (cards: BandCard[], offStored: string[] = []) =>
  [...contentSizedPlacements(cards, new Set(offStored))].sort();

describe("contentSizedPlacements", () => {
  it("lets two cards that share their rows exactly fit, and the full-width cards above and below", () => {
    // 🔴 Fails where an even pair is refused: the default pair row could then never shrink.
    expect(
      fitting([
        card("setup", 12, 2),
        card("attention", 8, 4),
        card("releases", 4, 4),
        card("below", 12, 4),
      ])
    ).toEqual(["attention", "below", "releases", "setup"]);
  });

  it("lets neither of two cards side by side fit when one spans more rows than the other", () => {
    // 🔴 Fails where each card is judged alone: three rows beside four, the four-row card's
    // request is spread over a row the three-row card does not span, and can draw the shorter
    // card past its stored height.
    expect(fitting([card("attention", 8, 3), card("releases", 4, 4)])).toEqual(
      []
    );
  });

  it("lets a lone full-width card fit", () => {
    expect(fitting([card("lone", 12, 4)])).toEqual(["lone"]);
  });

  it("joins cards into one band through a taller card whose rows they each share, and lets none of it fit", () => {
    // 🔴 Fails where only cards that overlap each other directly are banded: the first and third
    // share no row, but each shares rows with the tall card beside them, which the grid sizes
    // with both. The full-width card after the band is a band of its own, and fits.
    expect(
      fitting([
        card("first", 6, 2),
        card("tall", 6, 6),
        card("third", 6, 2),
        card("after", 12, 4),
      ])
    ).toEqual(["after"]);
  });

  it("lets no card of an even band fit while one of them is drawn across other rows than it stores", () => {
    // A card grown to show more, or collapsed to one line, no longer spans the rows its band
    // shares.
    expect(
      fitting([card("attention", 8, 4), card("releases", 4, 4)], ["attention"])
    ).toEqual([]);
  });
});

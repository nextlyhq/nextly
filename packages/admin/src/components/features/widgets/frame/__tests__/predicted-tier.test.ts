/**
 * A card's tier, known before its first query from the dashboard's width and the card's span.
 *
 * The card measures its own width once it is drawn, but the query that fills it is asked
 * before that, so the rows it asks for have to come from the same tier the card will then
 * measure. These are a 1,200 px, a 1,440 px and a 900 px dashboard, a 358 px phone column, and
 * the tier transitions on either side of 340 px, with each band's gap.
 */
import { describe, expect, it } from "vitest";

import { cardOuterWidth, predictedTier } from "../tier";

const WIDTHS = [3, 4, 6, 8, 12];

function tiersAt(dashboardWidth: number): Array<string | undefined> {
  return WIDTHS.map(w => predictedTier(w, dashboardWidth));
}

describe("a card's tier before it is drawn", () => {
  it("on a 1,200 px dashboard: 3 columns small, 4 and 6 medium, 8 and 12 large", () => {
    expect(tiersAt(1200)).toEqual([
      "small",
      "medium",
      "medium",
      "large",
      "large",
    ]);
  });

  it("on a 900 px dashboard, where 6 columns or fewer take half and wider takes the row", () => {
    expect(tiersAt(900)).toEqual([
      "medium",
      "medium",
      "medium",
      "large",
      "large",
    ]);
  });

  it("in a 358 px phone column every card is medium", () => {
    for (const w of WIDTHS) expect(predictedTier(w, 358)).toBe("medium");
  });

  it("crosses from small to medium where the drawn card does: 6 columns on 680 and 720 px", () => {
    // 🔴 The separating pair for the column arithmetic: on 680 px the card spans six columns
    // of a 16 px-gapped grid and is 332 px wide, on 720 px it is 352 px. A prediction that
    // ignored the gap (340 and 360) would call both medium.
    expect(predictedTier(6, 680)).toBe("small");
    expect(predictedTier(6, 720)).toBe("medium");
  });

  it("counts the 24 px gap across from a 1,280 px dashboard: 3 columns on 1,420 and 1,440 px", () => {
    // 🔴 The separating pair for the wide gap: with 24 px between columns a 3-column card on
    // 1,420 px is 337 px (small), where the 16 px gap would make it 343 px (medium).
    expect(predictedTier(3, 1420)).toBe("small");
    expect(predictedTier(3, 1440)).toBe("medium");
  });

  it("crosses in the single column at 330 and 350 px", () => {
    expect(predictedTier(12, 330)).toBe("small");
    expect(predictedTier(12, 350)).toBe("medium");
  });

  it("predicts each card's outer width from its columns and the grid's gaps", () => {
    // Twelve columns: a card spanning n of them is n twelfths of the dashboard plus its share
    // of one gap, less the gap after it.
    const at = (dashboardWidth: number) =>
      WIDTHS.map(
        w => Math.round(cardOuterWidth(w, dashboardWidth) * 100) / 100
      );
    expect(at(1200)).toEqual([288, 389.33, 592, 794.67, 1200]);
    expect(at(1440)).toEqual([342, 464, 708, 952, 1440]);
    expect(at(900)).toEqual([442, 442, 442, 900, 900]);
  });

  it("has no tier before the dashboard has a width", () => {
    expect(predictedTier(6, null)).toBeUndefined();
  });
});

/**
 * A card's tier, known before its first query from the dashboard's width and the card's span.
 *
 * The card measures its own width once it is drawn, but the query that fills it is asked
 * before that, so the rows it asks for have to come from the same tier the card will then
 * measure. These are the widths the dashboard spec names: a 1,200 px and a 900 px dashboard,
 * a 358 px phone column, and the tier transitions on either side of 340 px.
 */
import { describe, expect, it } from "vitest";

import type { WidgetWidth } from "@admin/types/dashboard/widgets";

import { cardOuterWidth, predictedTier } from "../tier";

const WIDTHS: WidgetWidth[] = ["quarter", "third", "half", "twoThirds", "full"];

function tiersAt(
  dashboardWidth: number
): Record<WidgetWidth, string | undefined> {
  return Object.fromEntries(
    WIDTHS.map(width => [width, predictedTier(width, dashboardWidth)])
  ) as Record<WidgetWidth, string | undefined>;
}

describe("a card's tier before it is drawn", () => {
  it("on a 1,200 px dashboard: a quarter is small, a third and a half medium, two-thirds and full large", () => {
    expect(tiersAt(1200)).toEqual({
      quarter: "small",
      third: "medium",
      half: "medium",
      twoThirds: "large",
      full: "large",
    });
  });

  it("on a 900 px dashboard, where the narrow widths take half and two-thirds takes the row", () => {
    expect(tiersAt(900)).toEqual({
      quarter: "medium",
      third: "medium",
      half: "medium",
      twoThirds: "large",
      full: "large",
    });
  });

  it("in a 358 px phone column every card is medium", () => {
    for (const width of WIDTHS)
      expect(predictedTier(width, 358)).toBe("medium");
  });

  it("crosses from small to medium where the drawn card does: a half on 680 and 720 px", () => {
    // 🔴 The separating pair for the track arithmetic: on 680 px the half spans six tracks of
    // a 24 px-gapped grid and is 328 px wide, on 720 px it is 348 px. A prediction that ignored
    // the gap (340 and 360) would call both medium.
    expect(predictedTier("half", 680)).toBe("small");
    expect(predictedTier("half", 720)).toBe("medium");
  });

  it("crosses in the single column at 330 and 350 px", () => {
    expect(predictedTier("full", 330)).toBe("small");
    expect(predictedTier("full", 350)).toBe("medium");
  });

  it("predicts each card's outer width from its tracks and the grid's gaps", () => {
    // Twelve tracks with 24 px between them: a card spanning n tracks is n twelfths of the
    // dashboard plus its share of one gap, less the gap after it.
    expect(WIDTHS.map(width => cardOuterWidth(width, 1200))).toEqual([
      282, 384, 588, 792, 1200,
    ]);
    expect(WIDTHS.map(width => cardOuterWidth(width, 900))).toEqual([
      438, 438, 438, 900, 900,
    ]);
  });

  it("has no tier before the dashboard has a width", () => {
    expect(predictedTier("half", null)).toBeUndefined();
  });
});

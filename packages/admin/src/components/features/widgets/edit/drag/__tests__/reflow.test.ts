/**
 * Where the cards go while one is dragged, and the width a card's dragged edge snaps to.
 *
 * The grid is 1,200px wide here: 16px gaps, so each of the twelve columns is 85⅓px and a column
 * with its gap 101⅓px.
 */
import { describe, expect, it } from "vitest";

import { widthChoices } from "../../../sizes";
import {
  columnsReached,
  nearestWidth,
  PAST_GRID_EDGE_PX,
  reflowTargetAt,
  reorderAround,
  type LaidOutCard,
} from "../reflow";

const WIDTH = 1200;

/** A card laid out at `left`, `top`, `width` by `height`, relative to the grid. */
function card(
  id: string,
  left: number,
  top: number,
  width: number,
  height = 100
): LaidOutCard {
  return {
    id,
    rect: { left, top, right: left + width, bottom: top + height },
  };
}

/** Two half-width cards on each of two rows: a and b, then c and d. */
const HALVES = [
  card("a", 0, 0, 592),
  card("b", 608, 0, 592),
  card("c", 0, 116, 592),
  card("d", 608, 116, 592),
];

describe("the card a dragged card is over", () => {
  it("splits a card narrower than the grid left and right", () => {
    expect(reflowTargetAt(HALVES, "a", { x: 700, y: 50 }, WIDTH)).toEqual({
      id: "b",
      side: "before",
    });
    expect(reflowTargetAt(HALVES, "a", { x: 1100, y: 50 }, WIDTH)).toEqual({
      id: "b",
      side: "after",
    });
  });

  it("splits a card as wide as the grid top and bottom, since its left and right are one place", () => {
    const rows = [card("a", 0, 0, 592), card("full", 0, 116, WIDTH)];
    expect(reflowTargetAt(rows, "a", { x: 1150, y: 130 }, WIDTH)).toEqual({
      id: "full",
      side: "before",
    });
    expect(reflowTargetAt(rows, "a", { x: 50, y: 200 }, WIDTH)).toEqual({
      id: "full",
      side: "after",
    });
  });

  it("reaches a card from the middle of the gap beside it, so crossing a gap never drops the aim", () => {
    // 4px into the 16px gap after a: nearer a than b.
    expect(reflowTargetAt(HALVES, "c", { x: 596, y: 50 }, WIDTH)).toEqual({
      id: "a",
      side: "after",
    });
    // 12px in: nearer b.
    expect(reflowTargetAt(HALVES, "c", { x: 604, y: 50 }, WIDTH)).toEqual({
      id: "b",
      side: "before",
    });
  });

  it("moves nothing over the held card's own place, or over no card", () => {
    expect(reflowTargetAt(HALVES, "a", { x: 100, y: 50 }, WIDTH)).toBe(
      undefined
    );
    expect(reflowTargetAt(HALVES, "a", { x: 100, y: 900 }, WIDTH)).toBe(
      undefined
    );
  });
});

describe("the order a drag reaches", () => {
  const order = ["a", "b", "c", "d"];

  it("puts the held card before or after the card it is over, across a row and down a row", () => {
    expect(reorderAround(order, "a", { id: "b", side: "after" })).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
    expect(reorderAround(order, "a", { id: "d", side: "before" })).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(reorderAround(order, "d", { id: "a", side: "before" })).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("hands back the same order when the move changes nothing, so a caller can tell by identity", () => {
    expect(reorderAround(order, "a", { id: "b", side: "before" })).toBe(order);
    expect(reorderAround(order, "a", { id: "x", side: "after" })).toBe(order);
  });
});

describe("the width a dragged edge reaches", () => {
  /** The middle of the gap after a card from the grid's left edge, `w` columns wide. */
  const gapAfter = (w: number) =>
    (w * (WIDTH - 11 * 16)) / 12 + (w - 1) * 16 + 8;

  it("counts whole columns at the middle of the gap after a card, measured from the card's own left edge", () => {
    expect(columnsReached(0, gapAfter(6), WIDTH)).toBeCloseTo(6, 5);
    expect(columnsReached(0, gapAfter(4), WIDTH)).toBeCloseTo(4, 5);
    // Halfway across the fifth column: between 4 and 5.
    const midFifth = gapAfter(4) + 8 + (WIDTH - 11 * 16) / 24;
    expect(columnsReached(0, midFifth, WIDTH)).toBeGreaterThan(4);
    expect(columnsReached(0, midFifth, WIDTH)).toBeLessThan(5);
    // A card that starts mid-row, after six columns: four columns to the gap after the tenth.
    expect(columnsReached(gapAfter(6) + 8, gapAfter(10), WIDTH)).toBeCloseTo(
      4,
      5
    );
  });

  it("reaches every column once the pointer passes the grid's right edge by more than the edge's strip", () => {
    // A card in the row's last column, from the gap after the sixth column.
    const left = gapAfter(6) + 8;
    // Just past the grid's edge, where the edge's own strip still stands: the columns it spans.
    expect(columnsReached(left, WIDTH + PAST_GRID_EDGE_PX, WIDTH)).toBeLessThan(
      7
    );
    // Further: all twelve, so the card snaps to its widest width.
    expect(columnsReached(left, WIDTH + PAST_GRID_EDGE_PX + 1, WIDTH)).toBe(12);
    expect(
      nearestWidth(
        [4, 6, 8],
        columnsReached(left, WIDTH + PAST_GRID_EDGE_PX + 1, WIDTH)
      )
    ).toBe(8);
  });

  it("snaps to the nearest of the card's width choices, the narrower on a tie", () => {
    const choices = widthChoices({
      default: { w: 6, h: 3 },
      min: { w: 3, h: 2 },
      max: { w: 12, h: 6 },
    });
    expect(choices).toEqual([3, 4, 6, 8, 9, 12]);
    // 50% dragged in to about 35%: 33%.
    expect(nearestWidth(choices, 4.3)).toBe(4);
    // Dragged out to the end of the row: 100%.
    expect(nearestWidth(choices, 11.8)).toBe(12);
    // Halfway between 33% and 50%: the narrower.
    expect(nearestWidth(choices, 5)).toBe(4);
  });

  it("stops at the widest choice however far past it the pointer goes", () => {
    const capped = widthChoices({
      default: { w: 3, h: 2 },
      min: { w: 3, h: 2 },
      max: { w: 8, h: 3 },
    });
    expect(capped).toEqual([3, 4, 6, 8]);
    expect(nearestWidth(capped, 12)).toBe(8);
    expect(nearestWidth(capped, 40)).toBe(8);
  });

  it("offers one width to a card bounded 5 to 5, and snaps every pointer to it", () => {
    const fixed = widthChoices({
      default: { w: 5, h: 2 },
      min: { w: 5, h: 2 },
      max: { w: 5, h: 2 },
    });
    expect(fixed).toEqual([5]);
    expect(nearestWidth(fixed, 1)).toBe(5);
    expect(nearestWidth(fixed, 12)).toBe(5);
  });

  it("has no width to snap to without choices", () => {
    expect(nearestWidth([], 6)).toBe(undefined);
  });
});

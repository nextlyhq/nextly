/**
 * Where a dragged card lands, and where the line that says so is drawn.
 *
 * Positions are FINAL positions: the index the card has once moved, counted in
 * the list without it, so "the same place" is always `final === from`. The
 * drop line is worked out from the cards as they are DRAWN (their spans on
 * the 12-column grid at this width), because that is what the reader sees,
 * and a line placed by stored width would sit beside the wrong card the moment
 * the dashboard narrows.
 */
import { describe, expect, it } from "vitest";

import {
  dropLineFor,
  finalPositionAt,
  keyboardStep,
  type DrawnCard,
} from "../drop-geometry";

/**
 * Two rows on a 1200 px grid with 24 px gaps: a half and a half, then a third,
 * a third and a third. Rects are relative to the grid.
 */
const CARDS: DrawnCard[] = [
  { id: "a", span: 6, rect: { left: 0, top: 0, right: 588, bottom: 200 } },
  { id: "b", span: 6, rect: { left: 612, top: 0, right: 1200, bottom: 200 } },
  { id: "c", span: 4, rect: { left: 0, top: 224, right: 384, bottom: 424 } },
  { id: "d", span: 4, rect: { left: 408, top: 224, right: 792, bottom: 424 } },
  { id: "e", span: 4, rect: { left: 816, top: 224, right: 1200, bottom: 424 } },
];
const GRID_WIDTH = 1200;

describe("finalPositionAt: which position the pointer is over", () => {
  it("goes before a card when the pointer is on its first half, after it on its second", () => {
    // Dragging `e` (index 4) over `c`'s left half: before `c`.
    expect(finalPositionAt(CARDS, 4, { x: 100, y: 300 }, GRID_WIDTH)).toBe(2);
    // Over `c`'s right half: after `c`.
    expect(finalPositionAt(CARDS, 4, { x: 300, y: 300 }, GRID_WIDTH)).toBe(3);
  });

  it("counts the final position without the card being moved", () => {
    // Dragging `a` (index 0) to after `d`: the gap after `d` is 4 in the list
    // with `a`, so 3 once `a` has left it.
    expect(finalPositionAt(CARDS, 0, { x: 700, y: 300 }, GRID_WIDTH)).toBe(3);
  });

  it("weighs vertical distance more than horizontal, so a pointer between rows keeps to the row beside it", () => {
    // 12 px left of `b` and 10 px below it, or 14 px straight above `d`.
    // Unweighted, `d` is nearer and the card would land after `c`; weighted,
    // `b` is, and it lands before `b`.
    expect(finalPositionAt(CARDS, 4, { x: 600, y: 210 }, GRID_WIDTH)).toBe(1);
  });

  it("splits a full-width card by its top and bottom halves rather than left and right", () => {
    const full: DrawnCard[] = [
      {
        id: "x",
        span: 12,
        rect: { left: 0, top: 0, right: 1200, bottom: 200 },
      },
      {
        id: "y",
        span: 12,
        rect: { left: 0, top: 224, right: 1200, bottom: 424 },
      },
    ];
    // On `y`'s right half but its top half: before `y`, which is where `x` is.
    expect(finalPositionAt(full, 0, { x: 1100, y: 250 }, GRID_WIDTH)).toBe(0);
    // `y`'s bottom half: after `y`.
    expect(finalPositionAt(full, 0, { x: 100, y: 400 }, GRID_WIDTH)).toBe(1);
  });

  it("answers nothing for an empty grid", () => {
    expect(finalPositionAt([], 0, { x: 0, y: 0 }, GRID_WIDTH)).toBeUndefined();
  });
});

describe("dropLineFor: where the line is drawn", () => {
  it("draws nothing for a move that changes nothing", () => {
    expect(dropLineFor(CARDS, 3, 3, GRID_WIDTH)).toBeUndefined();
  });

  it("draws a vertical line beside the card it lands after, within a row", () => {
    // `e` to between `c` and `d`: it does not start a row there.
    const line = dropLineFor(CARDS, 4, 3, GRID_WIDTH);
    expect(line).toMatchObject({ orientation: "vertical" });
    // Centred in the gap after `c`, as tall as `c`.
    expect(line).toEqual({
      orientation: "vertical",
      x: 396,
      top: 224,
      length: 200,
    });
  });

  it("draws a horizontal line above the card it lands before, when it will start a row", () => {
    // `c` to the front starts row one, so the line runs above `a`, the card
    // it lands before, centred in the gap above it.
    const line = dropLineFor(CARDS, 2, 0, GRID_WIDTH);
    expect(line).toEqual({
      orientation: "horizontal",
      y: -12,
      x: 0,
      length: GRID_WIDTH,
    });
  });

  it("draws a horizontal line below the last card when it will be last and start a row", () => {
    // `a` (a half) to the end: after c, d, e fill row two, so it starts row three.
    const line = dropLineFor(CARDS, 0, 4, GRID_WIDTH);
    expect(line).toEqual({
      orientation: "horizontal",
      y: 436,
      x: 0,
      length: GRID_WIDTH,
    });
  });
});

describe("keyboardStep: arrows move one place in list order", () => {
  it("moves back with Left and Up, on with Right and Down", () => {
    expect(keyboardStep(2, "ArrowLeft", 5)).toBe(1);
    expect(keyboardStep(2, "ArrowUp", 5)).toBe(1);
    expect(keyboardStep(2, "ArrowRight", 5)).toBe(3);
    expect(keyboardStep(2, "ArrowDown", 5)).toBe(3);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(keyboardStep(0, "ArrowLeft", 5)).toBe(0);
    expect(keyboardStep(4, "ArrowDown", 5)).toBe(4);
  });

  it("is not a step for any other key", () => {
    expect(keyboardStep(2, "Home", 5)).toBeUndefined();
  });
});

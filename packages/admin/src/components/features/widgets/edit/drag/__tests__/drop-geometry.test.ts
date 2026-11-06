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
 * Two rows on a 1200 px grid with 16 px gaps, each card three rows (248 px)
 * high: a half and a half, then a third, a third and a third. Rects are
 * relative to the grid, rounded to whole pixels.
 */
const CARDS: DrawnCard[] = [
  {
    id: "a",
    span: 6,
    rows: 3,
    rect: { left: 0, top: 0, right: 592, bottom: 248 },
  },
  {
    id: "b",
    span: 6,
    rows: 3,
    rect: { left: 608, top: 0, right: 1200, bottom: 248 },
  },
  {
    id: "c",
    span: 4,
    rows: 3,
    rect: { left: 0, top: 264, right: 389, bottom: 512 },
  },
  {
    id: "d",
    span: 4,
    rows: 3,
    rect: { left: 405, top: 264, right: 795, bottom: 512 },
  },
  {
    id: "e",
    span: 4,
    rows: 3,
    rect: { left: 811, top: 264, right: 1200, bottom: 512 },
  },
];
const GRID_WIDTH = 1200;

describe("finalPositionAt: which position the pointer is over", () => {
  it("goes before a card when the pointer is on its first half, after it on its second", () => {
    // Dragging `e` (index 4) over `c`'s left half: before `c`.
    expect(finalPositionAt(CARDS, 4, { x: 100, y: 330 }, GRID_WIDTH)).toBe(2);
    // Over `c`'s right half: after `c`.
    expect(finalPositionAt(CARDS, 4, { x: 300, y: 330 }, GRID_WIDTH)).toBe(3);
  });

  it("counts the final position without the card being moved", () => {
    // Dragging `a` (index 0) to after `d`: the gap after `d` is 4 in the list
    // with `a`, so 3 once `a` has left it.
    expect(finalPositionAt(CARDS, 0, { x: 700, y: 330 }, GRID_WIDTH)).toBe(3);
  });

  it("weighs vertical distance more than horizontal, so a pointer between rows keeps to the row beside it", () => {
    // 8 px beside `a` and `b` and 7 px below them, or 9 px straight above `d`.
    // Unweighted, `d` is nearer and the card would land after `c`; weighted,
    // the first row is, and it lands between `a` and `b`.
    expect(finalPositionAt(CARDS, 4, { x: 600, y: 255 }, GRID_WIDTH)).toBe(1);
  });

  it("splits a full-width card by its top and bottom halves rather than left and right", () => {
    const full: DrawnCard[] = [
      {
        id: "x",
        span: 12,
        rows: 3,
        rect: { left: 0, top: 0, right: 1200, bottom: 248 },
      },
      {
        id: "y",
        span: 12,
        rows: 3,
        rect: { left: 0, top: 264, right: 1200, bottom: 512 },
      },
    ];
    // On `y`'s right half but its top half: before `y`, which is where `x` is.
    expect(finalPositionAt(full, 0, { x: 1100, y: 290 }, GRID_WIDTH)).toBe(0);
    // `y`'s bottom half: after `y`.
    expect(finalPositionAt(full, 0, { x: 100, y: 490 }, GRID_WIDTH)).toBe(1);
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
    // Centred in the 16 px gap after `c`, as tall as `c`.
    expect(line).toEqual({
      orientation: "vertical",
      x: 397,
      top: 264,
      length: 248,
    });
  });

  it("centres a vertical line in the wider gap across from a 1,280 px grid", () => {
    // 🔴 The same move on a 1,440 px grid, whose columns are 98 px with 24 px between them:
    // column four ends at 464 and column five starts at 488, so the line is at 476, the gap's
    // centre. A fixed 16 px gap would put it at 477, off that centre.
    expect(dropLineFor(CARDS, 4, 3, 1440)).toMatchObject({
      orientation: "vertical",
      x: 476,
    });
  });

  it("places a card beside a taller one, under a shorter one, as the grid does", () => {
    // 🔴 A tall half (four rows) and a short half (two rows), then a half moved after them.
    // The grid puts it in the right-hand columns under the short half, beside the tall one's
    // lower rows. Counting columns alone, it starts a row of its own after twelve columns and
    // the line runs across the whole grid, below cards the card does not go below.
    const cards: DrawnCard[] = [
      {
        id: "tall",
        span: 6,
        rows: 4,
        rect: { left: 0, top: 0, right: 592, bottom: 336 },
      },
      {
        id: "short",
        span: 6,
        rows: 2,
        rect: { left: 608, top: 0, right: 1200, bottom: 160 },
      },
      {
        id: "moved",
        span: 6,
        rows: 2,
        rect: { left: 0, top: 352, right: 592, bottom: 512 },
      },
      {
        id: "last",
        span: 6,
        rows: 2,
        rect: { left: 608, top: 352, right: 1200, bottom: 512 },
      },
    ];
    // `last` to just after `short`: it lands under `short`, at row three, column seven.
    expect(dropLineFor(cards, 3, 2, GRID_WIDTH)).toEqual({
      orientation: "vertical",
      x: 600,
      top: 176,
      length: 160,
    });
    // The must-differ half: two full-height halves leave no room beside them, so the next half
    // starts a row, and that line does run across the grid.
    const even = cards.map(card =>
      card.id === "short" ? { ...card, rows: 4 } : card
    );
    expect(dropLineFor(even, 3, 2, GRID_WIDTH)).toEqual({
      orientation: "horizontal",
      y: 344,
      x: 0,
      length: GRID_WIDTH,
    });
  });

  it("draws a horizontal line above the card it lands before, when it will start a row", () => {
    // `c` to the front starts row one, so the line runs above `a`, the card
    // it lands before, centred in the gap above it.
    const line = dropLineFor(CARDS, 2, 0, GRID_WIDTH);
    expect(line).toEqual({
      orientation: "horizontal",
      y: -8,
      x: 0,
      length: GRID_WIDTH,
    });
  });

  it("draws a horizontal line below the last card when it will be last and start a row", () => {
    // `a` (a half) to the end: after c, d, e fill row two, so it starts row three.
    const line = dropLineFor(CARDS, 0, 4, GRID_WIDTH);
    expect(line).toEqual({
      orientation: "horizontal",
      y: 520,
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

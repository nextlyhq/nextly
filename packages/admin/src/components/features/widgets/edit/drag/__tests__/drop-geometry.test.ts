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
  gridPlacements,
  keyboardStep,
  type DrawnCard,
} from "../drop-geometry";

/**
 * Two rows on a 1200 px grid with 16 px gaps, each card 248 px tall: a half
 * and a half, then a third, a third and a third. Rects are relative to the
 * grid, rounded to whole pixels.
 */
const CARDS: DrawnCard[] = [
  {
    id: "a",
    span: 6,
    rect: { left: 0, top: 0, right: 592, bottom: 248 },
  },
  {
    id: "b",
    span: 6,
    rect: { left: 608, top: 0, right: 1200, bottom: 248 },
  },
  {
    id: "c",
    span: 4,
    rect: { left: 0, top: 264, right: 389, bottom: 512 },
  },
  {
    id: "d",
    span: 4,
    rect: { left: 405, top: 264, right: 795, bottom: 512 },
  },
  {
    id: "e",
    span: 4,
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
        rect: { left: 0, top: 0, right: 1200, bottom: 248 },
      },
      {
        id: "y",
        span: 12,
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

  describe("rows as tall as their tallest card, in the order after the move", () => {
    /**
     * Two halves side by side, 200 and 300 px tall, then two halves 150 and 100 px tall on the
     * row below, which is drawn at 316 px (300 and the 16 px gap).
     */
    const MIXED: DrawnCard[] = [
      { id: "x", span: 6, rect: { left: 0, top: 0, right: 592, bottom: 200 } },
      {
        id: "y",
        span: 6,
        rect: { left: 608, top: 0, right: 1200, bottom: 300 },
      },
      {
        id: "z",
        span: 6,
        rect: { left: 0, top: 316, right: 592, bottom: 466 },
      },
      {
        id: "w",
        span: 6,
        rect: { left: 608, top: 316, right: 1200, bottom: 416 },
      },
    ];

    it("puts the line above a row below the first row's tallest card", () => {
      // 🔴 `w` to before `z` starts the second row: the gap above it is under `y`, the taller of
      // the first row's cards, at 300 + 16 / 2. The first card's height would put it at 208,
      // and the moved card's own at 108.
      expect(dropLineFor(MIXED, 3, 2, GRID_WIDTH)).toEqual({
        orientation: "horizontal",
        y: 300 + 16 - 8,
        x: 0,
        length: GRID_WIDTH,
      });
    });

    it("draws a vertical line as tall as its row will be once the card has moved", () => {
      // `z` to between `x` and `y`: `y` goes down a row, so the first row holds `x` and `z`, and
      // is 200 px tall, not the 300 `y` made it before, nor `z`'s own 150.
      expect(dropLineFor(MIXED, 2, 1, GRID_WIDTH)).toEqual({
        orientation: "vertical",
        x: 600,
        top: 0,
        length: 200,
      });
      // `x` to the end: `y` and `z` share the first row (300 px), so the second starts at 316,
      // and `w` and `x` make it 200 px tall.
      expect(dropLineFor(MIXED, 0, 3, GRID_WIDTH)).toEqual({
        orientation: "vertical",
        x: 600,
        top: 316,
        length: 200,
      });
    });

    it("sizes a row by each card's content, not the height its old row stretched it to", () => {
      // As a page draws them: `x` stretched to its row's 300 px, its content 200 px tall. `z` to
      // between `x` and `y` leaves `x` and `z` in the first row, which is then 200 px tall, as
      // `x`'s content is, not the 300 its old row stretched it to.
      const stretched: DrawnCard[] = MIXED.map(card =>
        card.id === "x"
          ? { ...card, contentHeight: 200, rect: { ...card.rect, bottom: 300 } }
          : card.id === "w"
            ? {
                ...card,
                contentHeight: 100,
                rect: { ...card.rect, bottom: 466 },
              }
            : card
      );
      expect(dropLineFor(stretched, 2, 1, GRID_WIDTH)).toEqual({
        orientation: "vertical",
        x: 600,
        top: 0,
        length: 200,
      });
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

describe("gridPlacements: where the grid places each card", () => {
  it("places each card one row high, beside the last while its span fits, else at the next row's start", () => {
    expect(
      gridPlacements([
        { span: 6 },
        { span: 4 },
        { span: 4 },
        { span: 12 },
        { span: 3 },
      ])
    ).toEqual([
      { column: 0, row: 0 },
      { column: 6, row: 0 },
      { column: 0, row: 1 },
      { column: 0, row: 2 },
      { column: 0, row: 3 },
    ]);
  });

  it("never backfills a gap with a later card", () => {
    // 🔴 A dense grid would put the third card in the four columns left beside the first.
    expect(gridPlacements([{ span: 8 }, { span: 6 }, { span: 4 }])).toEqual([
      { column: 0, row: 0 },
      { column: 0, row: 1 },
      { column: 6, row: 1 },
    ]);
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

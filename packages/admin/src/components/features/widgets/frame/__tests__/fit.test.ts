/**
 * The height a cell asks of the dashboard's content-sized rows for a card whose body reports the
 * height its content takes, at most its stored height, and the style that carries it; and which
 * lists may report it. The cell's half, drawn in the grid, is in `WidgetGrid.test.tsx`.
 */
import { LIST_ROW_HEIGHT_PX } from "nextly/card-geometry";
import { describe, expect, it } from "vitest";

import { cardHeightPx } from "../../sizes";
import { cellRowStyle, leavesRowsEmpty, requestedCardHeightPx } from "../fit";
import { cardBodyHeightPx } from "../measures";

/** What the frame draws around a card's body: the same at every height. */
const FRAME = cardHeightPx(4) - cardBodyHeightPx(4);

describe("requestedCardHeightPx", () => {
  it("asks for the card that holds the reported body, so the taller of two in a row is the row's height", () => {
    // 🔴 Fails where a card fitted to its content is drawn in whole rows: one row of 52 px would
    // ask for three rows' height, 248 px, leaving 82 px under the item.
    const one = requestedCardHeightPx(4, LIST_ROW_HEIGHT_PX.default);
    const two = requestedCardHeightPx(4, 2 * LIST_ROW_HEIGHT_PX.default);
    expect(one).toBe(FRAME + LIST_ROW_HEIGHT_PX.default);
    expect(two).toBe(FRAME + 2 * LIST_ROW_HEIGHT_PX.default);
    expect(Math.max(one, two)).toBe(two);
    // The frame is the same whatever the rows: the frame's own measures, one formula.
    expect(cardHeightPx(2) - cardBodyHeightPx(2)).toBe(FRAME);
    // A fraction of a pixel is rounded up, so the last row is never cut.
    expect(requestedCardHeightPx(4, 52.2)).toBe(FRAME + 53);
  });

  it("never asks for more than the card's stored rows draw it at", () => {
    expect(requestedCardHeightPx(4, cardBodyHeightPx(4))).toBe(cardHeightPx(4));
    expect(requestedCardHeightPx(4, cardBodyHeightPx(4) + 1)).toBe(
      cardHeightPx(4)
    );
    expect(requestedCardHeightPx(2, 10_000)).toBe(cardHeightPx(2));
  });

  it("asks for the stored height for a body that reports nothing, or nothing it can draw by", () => {
    // 🔴 Fails where an unreported card asks for nothing: content-sized rows would then shrink
    // under it to whatever the cards beside it ask for.
    expect(requestedCardHeightPx(4, undefined)).toBe(cardHeightPx(4));
    expect(requestedCardHeightPx(4, Number.NaN)).toBe(cardHeightPx(4));
    expect(requestedCardHeightPx(4, -1)).toBe(cardHeightPx(4));
  });
});

describe("cellRowStyle", () => {
  it("spans the card's rows in every mode, and asks for its height only where the rows take it", () => {
    // 🔴 Fails where a fitted card's span changes: its rows are what places every card after it.
    expect(cellRowStyle(4, 166)).toEqual({
      gridRow: "span 4 / span 4",
      minHeight: "166px",
    });
    // Customise mode's fixed rows: the span alone, as the cell was always drawn.
    expect(cellRowStyle(4, undefined)).toEqual({ gridRow: "span 4 / span 4" });
  });
});

describe("leavesRowsEmpty", () => {
  it("is yes while at least one whole row of the stored body stays empty, and no once the list fills it", () => {
    // Four rows' body holds four default rows.
    expect(Math.floor(cardBodyHeightPx(4) / LIST_ROW_HEIGHT_PX.default)).toBe(
      4
    );
    expect(leavesRowsEmpty(1, 4, "default")).toBe(true);
    expect(leavesRowsEmpty(3, 4, "default")).toBe(true);
    expect(leavesRowsEmpty(4, 4, "default")).toBe(false);
    expect(leavesRowsEmpty(9, 4, "default")).toBe(false);
  });

  it("counts the rows under what the body draws above them", () => {
    // 🔴 Fails where the room above the rows is not taken off: under a 32 px line a four-row body
    // holds three rows, and three fill it.
    expect(leavesRowsEmpty(3, 4, "default", 32)).toBe(false);
    expect(leavesRowsEmpty(2, 4, "default", 32)).toBe(true);
  });

  it("is no for a card of unknown height", () => {
    expect(leavesRowsEmpty(1, undefined, "default")).toBe(false);
  });
});

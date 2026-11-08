/**
 * How a cell draws a card whose content takes less than its stored rows: across the whole row in
 * the fewest rows that hold it, beside another card at its own rows aligned to their top, and at
 * its stored rows, stretched, otherwise. The cell's half, drawn in the grid, is in
 * `WidgetGrid.test.tsx`.
 */
import { LIST_ROW_HEIGHT_PX } from "nextly/card-geometry";
import { describe, expect, it } from "vitest";

import { drawnAcrossWholeRow, fittedCell, leavesRowsEmpty } from "../fit";
import { cardBodyHeightPx } from "../measures";

const beside = { fullRow: false, minRows: 3 };
const across = { fullRow: true, minRows: 3 };

describe("fittedCell", () => {
  it("keeps the stored rows, stretched, when the body reports nothing or needs all of them", () => {
    const stretched = { rows: 4, alignStart: false };
    for (const placed of [beside, across]) {
      expect(fittedCell(4, undefined, placed)).toEqual(stretched);
      expect(fittedCell(4, Number.NaN, placed)).toEqual(stretched);
      expect(fittedCell(4, cardBodyHeightPx(4), placed)).toEqual(stretched);
      expect(fittedCell(4, cardBodyHeightPx(4) + 1, placed)).toEqual(stretched);
    }
  });

  it("beside another card, keeps its stored rows and stands at its content's height", () => {
    // The rows stay, so no card beside it or below it moves; only its own height follows.
    expect(fittedCell(4, LIST_ROW_HEIGHT_PX.default, beside)).toEqual({
      rows: 4,
      alignStart: true,
    });
  });

  it("across the whole row, spans the fewest rows that hold its content, never under its minimum", () => {
    // One row of 52 px: two rows' body (46 px) is too short, three's holds it.
    expect(cardBodyHeightPx(2)).toBeLessThan(LIST_ROW_HEIGHT_PX.default);
    expect(
      fittedCell(6, LIST_ROW_HEIGHT_PX.default, { fullRow: true, minRows: 2 })
    ).toEqual({ rows: 3, alignStart: false });
    // Exactly four rows' body is four rows, one pixel more is five.
    expect(fittedCell(6, cardBodyHeightPx(4), across)).toEqual({
      rows: 4,
      alignStart: false,
    });
    expect(fittedCell(6, cardBodyHeightPx(4) + 1, across)).toEqual({
      rows: 5,
      alignStart: false,
    });
    // Nothing at all to hold: the widget's minimum, not the grid's.
    expect(fittedCell(6, 0, across)).toEqual({ rows: 3, alignStart: false });
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

  it("is no for a card of unknown height", () => {
    expect(leavesRowsEmpty(1, undefined, "default")).toBe(false);
  });
});

describe("drawnAcrossWholeRow", () => {
  it("is yes where the dashboard draws the card twelve columns wide, and no beside another or unmeasured", () => {
    // From 1,024 px a card is drawn at its own w; below it, a w past six takes the whole row.
    expect(drawnAcrossWholeRow(12, 1200)).toBe(true);
    expect(drawnAcrossWholeRow(8, 1200)).toBe(false);
    expect(drawnAcrossWholeRow(8, 900)).toBe(true);
    expect(drawnAcrossWholeRow(4, 900)).toBe(false);
    expect(drawnAcrossWholeRow(4, 390)).toBe(true);
    expect(drawnAcrossWholeRow(12, undefined)).toBe(false);
  });
});

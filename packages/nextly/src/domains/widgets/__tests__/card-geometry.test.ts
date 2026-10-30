/**
 * How many list rows a card's body holds: the one formula the admin draws its list cards by and
 * a widget's `load` reads its `size` by (`rowsThatFit`). The numbers are written out rather than
 * recomputed, so a change to any measure shows here; the admin's own test holds its row math to
 * the same answers.
 */
import { describe, expect, it } from "vitest";

import {
  cardBodyHeightPx,
  LIST_ROW_HEIGHT_PX,
  rowsInBody,
  rowsThatFit,
} from "../card-geometry";
import { MAX_GRID_ROWS, MIN_GRID_ROWS } from "../grid-size";
import { MAX_WIDGET_ROWS } from "../query-limits";

describe("rowsThatFit", () => {
  it("counts the whole default rows a card's body holds at each height", () => {
    // A body of 46, 134, 222, 310, 398 and 486 px (`cardBodyHeightPx`), over rows of 52 px.
    expect(
      [2, 3, 4, 5, 6, 7].map(h => rowsThatFit({ h }, { density: "default" }))
    ).toEqual([0, 2, 4, 5, 7, 9]);
  });

  it("counts more compact rows in the same card", () => {
    // 🔴 The separating pair: a count that ignored density gives both rows the same number.
    // The same bodies over rows of 36 px.
    expect(
      [2, 3, 4, 5].map(h => rowsThatFit({ h }, { density: "compact" }))
    ).toEqual([1, 3, 6, 8]);
  });

  it("never counts more than ten rows, however tall the card", () => {
    expect(MAX_WIDGET_ROWS).toBe(10);
    // 574 px holds eleven default rows and 926 px seventeen: both draw ten.
    expect(rowsThatFit({ h: 8 }, { density: "default" })).toBe(10);
    expect(rowsThatFit({ h: MAX_GRID_ROWS }, { density: "default" })).toBe(10);
    // Six rows hold eleven compact rows (398 / 36), so the cap binds there too.
    expect(rowsThatFit({ h: 6 }, { density: "compact" })).toBe(10);
  });

  it("is the card's body height over one row's height, from the shortest card to the tallest", () => {
    for (let h = MIN_GRID_ROWS; h <= MAX_GRID_ROWS; h++) {
      for (const density of ["default", "compact"] as const) {
        expect(rowsThatFit({ h }, { density })).toBe(
          Math.min(
            Math.floor(cardBodyHeightPx(h) / LIST_ROW_HEIGHT_PX[density]),
            MAX_WIDGET_ROWS
          )
        );
        expect(rowsThatFit({ h }, { density })).toBe(
          rowsInBody(cardBodyHeightPx(h), density)
        );
      }
    }
  });

  it("reads a load's whole size as it is handed, by its height alone", () => {
    // As a load passes it: the size it was handed, held in a variable.
    const size = { w: 4, h: 4, tier: "small" as const };
    const wider = { ...size, w: 12, tier: "large" as const };
    expect(rowsThatFit(size, { density: "default" })).toBe(
      rowsThatFit(wider, { density: "default" })
    );
  });
});

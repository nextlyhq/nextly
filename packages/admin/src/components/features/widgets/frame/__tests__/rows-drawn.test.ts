/**
 * How many rows a card draws at each tier and density.
 *
 * The displays, the query and the loading card's reservation all read this, so
 * what is pinned here is the one answer they share: whole rows that fit the
 * body at its density, at most ten, and fewer where the setting asks for fewer.
 */
import {
  DEFAULT_WIDGET_LIMIT,
  MAX_WIDGET_LIMIT,
  MAX_WIDGET_ROWS,
} from "nextly/config";
import { rowsThatFit } from "nextly/card-geometry";
import { describe, expect, it } from "vitest";

import { LIST_ROW_HEIGHT_CLASS } from "../geometry";
import {
  LIST_ROW_HEIGHT_PX,
  listDensityOf,
  rowsInBody,
  tierBodyHeight,
} from "../list-rows";
import { rowsDrawn } from "../tier";

describe("rowsInBody", () => {
  it("counts whole rows only, never part of one", () => {
    const row = LIST_ROW_HEIGHT_PX.default;
    expect(rowsInBody(row * 4, "default")).toBe(4);
    // One pixel short of a fifth row is still four.
    expect(rowsInBody(row * 5 - 1, "default")).toBe(4);
  });

  it("fits more compact rows in the same height", () => {
    // 🔴 The separating pair: a rule that ignored density gives both the same.
    expect(rowsInBody(260, "default")).toBe(5);
    expect(rowsInBody(260, "compact")).toBe(7);
  });

  it("never fits more than the card maximum", () => {
    expect(MAX_WIDGET_ROWS).toBe(10);
    expect(rowsInBody(10_000, "compact")).toBe(MAX_WIDGET_ROWS);
  });

  it("fits nothing in a body with no room or no height", () => {
    for (const height of [0, -40, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rowsInBody(height, "default")).toBe(0);
    }
  });
});

describe("rowsDrawn", () => {
  it("draws three, five and ten rows at the small, medium and large tiers", () => {
    expect(rowsDrawn("small", 10)).toBe(3);
    expect(rowsDrawn("medium", 10)).toBe(5);
    expect(rowsDrawn("large", 10)).toBe(10);
  });

  it("draws more rows at the same tier when compact", () => {
    expect(rowsDrawn("medium", 10, "compact")).toBe(
      rowsInBody(tierBodyHeight("medium"), "compact")
    );
    expect(rowsDrawn("medium", 10, "compact")).toBeGreaterThan(
      rowsDrawn("medium", 10)
    );
  });

  it("draws the rows a card's height holds, the same at every tier", () => {
    // 🔴 Counted from the tier alone, a taller card at the same width draws the rows a shorter
    // one does and leaves the rest of its body empty.
    const rows = (h: number, density: "default" | "compact" = "default") =>
      rowsDrawn({ tier: "medium", h }, 10, density);
    expect([3, 4, 5, 6, 7, 8].map(h => rows(h))).toEqual([2, 4, 5, 7, 9, 10]);
    expect([3, 4, 5, 6].map(h => rows(h, "compact"))).toEqual([3, 6, 8, 10]);
    // The tier lays the rows out; it does not count them once the card has a height.
    expect(rowsDrawn({ tier: "small", h: 5 }, 10)).toBe(rows(5));
    expect(rowsDrawn({ tier: "large", h: 5 }, 10)).toBe(rows(5));
  });

  it("draws no row in a card two rows high at the default density, one when compact, as a load counts", () => {
    // 🔴 The frame and a widget's `load` read one number: a 46 px body holds no 52 px row and one
    // 36 px row. A frame that drew a row the load did not ask for, or the reverse, would draw a
    // row of nothing or leave out a row it was answered.
    expect(rowsDrawn({ tier: "medium", h: 2 }, 10, "default")).toBe(0);
    expect(rowsDrawn({ tier: "medium", h: 2 }, 10, "compact")).toBe(1);
    for (const density of ["default", "compact"] as const) {
      expect(rowsDrawn({ tier: "medium", h: 2 }, 10, density), density).toBe(
        rowsThatFit({ h: 2 }, { density })
      );
    }
  });

  it("draws fewer when the setting asks for fewer", () => {
    expect(rowsDrawn("large", 4)).toBe(4);
    expect(rowsDrawn("small", 2)).toBe(2);
  });

  it("draws no more than the card maximum, below the server's clamp", () => {
    // The card maximum is its own number: the server allows a query up to its
    // clamp, and a card asks one row above what it draws.
    expect(MAX_WIDGET_ROWS).toBeLessThan(MAX_WIDGET_LIMIT);
    expect(rowsDrawn("large", MAX_WIDGET_ROWS + 10, "compact")).toBe(
      MAX_WIDGET_ROWS
    );
  });

  it("reads a missing or garbage setting as the query does", () => {
    for (const items of [undefined, Number.NaN, "ten", null]) {
      expect(rowsDrawn("large", items)).toBe(DEFAULT_WIDGET_LIMIT);
      expect(rowsDrawn("small", items)).toBe(Math.min(DEFAULT_WIDGET_LIMIT, 3));
    }
    expect(rowsDrawn("large", 0)).toBe(1);
    expect(rowsDrawn("large", -4)).toBe(1);
    expect(rowsDrawn("large", 6.9)).toBe(6);
  });
});

describe("listDensityOf", () => {
  it("reads the card's chosen density", () => {
    expect(listDensityOf({ density: "compact" })).toBe("compact");
  });

  it("reads none, or a value no density has, as default", () => {
    for (const settings of [undefined, null, {}, { density: "tight" }, "x"]) {
      expect(listDensityOf(settings)).toBe("default");
    }
  });
});

describe("the rows a widget's load is told fit", () => {
  it("are the rows the admin draws for a card of that height, at either density", () => {
    // 🔴 A load that reads `rowsThatFit(size, { density })` asks for exactly the rows the card's
    // list then draws: a count of its own, one row off at any height, would leave a row empty or
    // ask for one the card hides. At a full "Number of items", so only the body decides.
    for (const h of [2, 3, 4, 6, 8, 12]) {
      for (const density of ["default", "compact"] as const) {
        expect(rowsThatFit({ h }, { density })).toBe(
          rowsDrawn({ tier: "medium", h }, MAX_WIDGET_ROWS, density)
        );
      }
    }
  });

  it("follow the row heights the list rows are drawn in", () => {
    // Each density's row class is Tailwind's height utility of that many pixels: a step of the
    // spacing scale is 0.25rem, 4 px at the root size the admin's grid is measured in. The
    // class text has to be written out for Tailwind to see it, so it is held to the number here.
    for (const density of ["default", "compact"] as const) {
      expect(LIST_ROW_HEIGHT_CLASS[density]).toBe(
        `h-${LIST_ROW_HEIGHT_PX[density] / 4}`
      );
    }
  });
});

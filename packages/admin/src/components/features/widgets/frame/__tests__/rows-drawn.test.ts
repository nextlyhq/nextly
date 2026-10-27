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
import { describe, expect, it } from "vitest";

import {
  LIST_ROW_HEIGHT_PX,
  listDensityOf,
  rowsThatFit,
  tierBodyHeight,
} from "../list-rows";
import { rowsDrawn } from "../tier";

describe("rowsThatFit", () => {
  it("counts whole rows only, never part of one", () => {
    const row = LIST_ROW_HEIGHT_PX.default;
    expect(rowsThatFit(row * 4, "default")).toBe(4);
    // One pixel short of a fifth row is still four.
    expect(rowsThatFit(row * 5 - 1, "default")).toBe(4);
  });

  it("fits more compact rows in the same height", () => {
    // 🔴 The separating pair: a rule that ignored density gives both the same.
    expect(rowsThatFit(260, "default")).toBe(5);
    expect(rowsThatFit(260, "compact")).toBe(7);
  });

  it("never fits more than the card maximum", () => {
    expect(MAX_WIDGET_ROWS).toBe(10);
    expect(rowsThatFit(10_000, "compact")).toBe(MAX_WIDGET_ROWS);
  });

  it("fits nothing in a body with no room or no height", () => {
    for (const height of [0, -40, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rowsThatFit(height, "default")).toBe(0);
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
      rowsThatFit(tierBodyHeight("medium"), "compact")
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

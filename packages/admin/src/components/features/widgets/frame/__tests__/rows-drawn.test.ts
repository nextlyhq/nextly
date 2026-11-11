/**
 * How many rows a list card draws: its "Number of entries", read by core's rule (`listEntries`).
 *
 * The displays, the query and the loading card's reservation all read this, so what is pinned
 * here is the one answer they share: the setting, five where it is missing or garbage, at least
 * one and at most twenty, whatever the card's size or density.
 */
import {
  DEFAULT_WIDGET_LIMIT,
  listEntries,
  MAX_WIDGET_LIMIT,
  MAX_WIDGET_ROWS,
} from "nextly/config";
import { describe, expect, it } from "vitest";

import { LIST_ROW_HEIGHT_CLASS } from "../geometry";
import { LIST_ROW_HEIGHT_PX, listDensityOf } from "../list-rows";
import { rowsDrawn } from "../tier";

describe("rowsDrawn", () => {
  it("draws the card's Number of entries", () => {
    expect(rowsDrawn(1)).toBe(1);
    expect(rowsDrawn(7)).toBe(7);
    expect(rowsDrawn(10)).toBe(10);
    expect(rowsDrawn(20)).toBe(20);
  });

  it("draws no more than twenty, below the server's clamp", () => {
    // The card maximum is its own number: the server allows a query up to its clamp, and a card
    // asks one row above what it draws.
    expect(MAX_WIDGET_ROWS).toBe(20);
    expect(MAX_WIDGET_ROWS).toBeLessThan(MAX_WIDGET_LIMIT);
    expect(rowsDrawn(25)).toBe(20);
    expect(rowsDrawn(MAX_WIDGET_LIMIT + 10)).toBe(20);
  });

  it("reads a missing or garbage setting as the query does", () => {
    for (const items of [undefined, Number.NaN, "ten", "10", null]) {
      expect(rowsDrawn(items)).toBe(DEFAULT_WIDGET_LIMIT);
    }
    expect(rowsDrawn(0)).toBe(1);
    expect(rowsDrawn(-4)).toBe(1);
    expect(rowsDrawn(6.9)).toBe(6);
  });

  it("is the rule a widget's load asks its rows by", () => {
    // 🔴 A count of its own, one row off for any setting, would leave a row empty or draw the
    // row past the card's rows that only says more exist.
    for (const items of [undefined, "x", 0, 1, 5, 7, 10, 12.5, 20, 21, 50]) {
      expect(rowsDrawn(items)).toBe(listEntries(items));
    }
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

describe("the row heights", () => {
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

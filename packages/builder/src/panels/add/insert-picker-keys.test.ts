/**
 * The picker's arrows: in the grid of six every arrow moves, Up and Down by
 * a row; in the results only Up and Down do; nothing wraps.
 *
 * @module insert-picker-keys.test
 */
import { describe, expect, it } from "vitest";

import { gridRows, movedHighlight } from "./insert-picker-keys";

describe("the picker's highlight", () => {
  it("moves by a cell with Left and Right and by a row with Up and Down in the grid", () => {
    expect(movedHighlight("grid", 0, 6, "ArrowRight")).toBe(1);
    expect(movedHighlight("grid", 1, 6, "ArrowLeft")).toBe(0);
    expect(movedHighlight("grid", 1, 6, "ArrowDown")).toBe(4);
    expect(movedHighlight("grid", 4, 6, "ArrowUp")).toBe(1);
  });

  it("stays put at the grid's edges rather than wrapping", () => {
    expect(movedHighlight("grid", 0, 6, "ArrowLeft")).toBe(0);
    expect(movedHighlight("grid", 5, 6, "ArrowRight")).toBe(5);
    expect(movedHighlight("grid", 1, 6, "ArrowUp")).toBe(1);
    expect(movedHighlight("grid", 4, 6, "ArrowDown")).toBe(4);
    // A short last row: Down from a cell with nothing below stays.
    expect(movedHighlight("grid", 2, 5, "ArrowDown")).toBe(2);
  });

  it("moves by one with Up and Down in the list, and leaves Left and Right to the field", () => {
    expect(movedHighlight("list", 0, 4, "ArrowDown")).toBe(1);
    expect(movedHighlight("list", 3, 4, "ArrowDown")).toBe(3);
    expect(movedHighlight("list", 0, 4, "ArrowUp")).toBe(0);
    expect(movedHighlight("list", 1, 4, "ArrowRight")).toBeUndefined();
    expect(movedHighlight("list", 1, 4, "ArrowLeft")).toBeUndefined();
  });

  it("goes to either end with Home and End, and ignores other keys", () => {
    expect(movedHighlight("list", 2, 4, "Home")).toBe(0);
    expect(movedHighlight("grid", 2, 6, "End")).toBe(5);
    expect(movedHighlight("grid", 2, 6, "a")).toBeUndefined();
    expect(movedHighlight("grid", 0, 0, "ArrowDown")).toBeUndefined();
  });

  it("lays the six out in rows of three", () => {
    expect(gridRows([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });
});

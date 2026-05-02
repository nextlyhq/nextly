// Why: the WYSIWYG builder packs fields into auto-flow rows by width.
// reflow() is called after every drop and every Apply that changes a width.
// These tests lock the packing rules so DnD changes don't quietly break layout.
import { describe, expect, it } from "vitest";

import { packIntoRows, type WidthField } from "../reflow";

const f = (id: string, w: 25 | 50 | 75 | 100): WidthField => ({ id, width: w });

describe("packIntoRows", () => {
  it("returns empty rows for empty input", () => {
    expect(packIntoRows([])).toEqual([]);
  });

  it("packs fields whose widths sum to <= 100 into one row", () => {
    const rows = packIntoRows([f("a", 50), f("b", 50)]);
    expect(rows).toEqual([[f("a", 50), f("b", 50)]]);
  });

  it("wraps overflow into a new row", () => {
    const rows = packIntoRows([f("a", 75), f("b", 50)]);
    expect(rows).toEqual([[f("a", 75)], [f("b", 50)]]);
  });

  it("respects insertion order and does not greedily backfill earlier rows", () => {
    const rows = packIntoRows([f("a", 50), f("b", 75), f("c", 25)]);
    expect(rows).toEqual([[f("a", 50)], [f("b", 75), f("c", 25)]]);
  });

  it("treats 100% fields as their own row", () => {
    const rows = packIntoRows([f("a", 50), f("b", 100), f("c", 50)]);
    expect(rows).toEqual([[f("a", 50)], [f("b", 100)], [f("c", 50)]]);
  });

  it("packs four 25% fields into one row", () => {
    const rows = packIntoRows([f("a", 25), f("b", 25), f("c", 25), f("d", 25)]);
    expect(rows).toEqual([[f("a", 25), f("b", 25), f("c", 25), f("d", 25)]]);
  });
});

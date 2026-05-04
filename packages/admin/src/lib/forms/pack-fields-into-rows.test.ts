import type { FieldConfig } from "@revnixhq/nextly/config";
import { describe, it, expect } from "vitest";

import { packFieldsIntoRows } from "./pack-fields-into-rows";

// Lightweight builders for terse assertions. The renderer only inspects
// `type`, `name`, and `admin.width` — nothing else here matters.
const text = (name: string, width?: string): FieldConfig =>
  ({
    type: "text",
    name,
    ...(width ? { admin: { width } } : {}),
  }) as FieldConfig;

const block = (type: string, name?: string): FieldConfig =>
  ({ type, ...(name ? { name } : {}) }) as unknown as FieldConfig;

describe("packFieldsIntoRows", () => {
  it("empty list → no rows", () => {
    expect(packFieldsIntoRows([])).toEqual([]);
  });

  it("single 100% field → one row of one", () => {
    const f = text("title", "100%");
    expect(packFieldsIntoRows([f])).toEqual([[f]]);
  });

  it("two 50% fields → one row of two", () => {
    const a = text("a", "50%");
    const b = text("b", "50%");
    expect(packFieldsIntoRows([a, b])).toEqual([[a, b]]);
  });

  it("three 33% fields → one row of three", () => {
    const a = text("a", "33%");
    const b = text("b", "33%");
    const c = text("c", "33%");
    expect(packFieldsIntoRows([a, b, c])).toEqual([[a, b, c]]);
  });

  it("[50%, 30%] sums to 80% → still one row", () => {
    const a = text("a", "50%");
    const b = text("b", "30%");
    expect(packFieldsIntoRows([a, b])).toEqual([[a, b]]);
  });

  it("[50%, 60%] would overflow → two rows", () => {
    const a = text("a", "50%");
    const b = text("b", "60%");
    expect(packFieldsIntoRows([a, b])).toEqual([[a], [b]]);
  });

  it("[50%, 50%, 100%] → row of two, then full-width row", () => {
    const a = text("a", "50%");
    const b = text("b", "50%");
    const c = text("c", "100%");
    expect(packFieldsIntoRows([a, b, c])).toEqual([[a, b], [c]]);
  });

  it("block field always starts its own row, regardless of width", () => {
    const a = text("a", "50%");
    const g = block("group", "address");
    const b = text("b", "50%");
    expect(packFieldsIntoRows([a, g, b])).toEqual([[a], [g], [b]]);
  });

  it("richText is treated as a block field (always full row)", () => {
    const a = text("a", "50%");
    const r = block("richText", "content");
    const b = text("b", "50%");
    expect(packFieldsIntoRows([a, r, b])).toEqual([[a], [r], [b]]);
  });

  it("field with no admin.width is treated as 100% (own row)", () => {
    const a = text("a"); // no width → defaults to 100%
    const b = text("b", "50%");
    expect(packFieldsIntoRows([a, b])).toEqual([[a], [b]]);
  });

  it("Tabs / Row / Collapsible / Array / Blocks / Component all force a row break", () => {
    const a = text("a", "50%");
    const types = [
      "tabs",
      "row",
      "collapsible",
      "array",
      "blocks",
      "component",
    ];
    for (const t of types) {
      const blockField = block(t);
      const b = text("b", "50%");
      const result = packFieldsIntoRows([a, blockField, b]);
      expect(result, `block type=${t}`).toEqual([[a], [blockField], [b]]);
    }
  });

  it("two block fields in a row each get their own row", () => {
    const g1 = block("group", "g1");
    const g2 = block("group", "g2");
    expect(packFieldsIntoRows([g1, g2])).toEqual([[g1], [g2]]);
  });

  it("malformed admin.width string is treated as full-width (safe fallback)", () => {
    const a = text("a", "fifty percent"); // not parseable
    const b = text("b", "50%");
    expect(packFieldsIntoRows([a, b])).toEqual([[a], [b]]);
  });
});

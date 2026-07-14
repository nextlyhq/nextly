import { describe, it, expect } from "vitest";

import {
  defineCellRenderer,
  getCellRenderer,
  getRegisteredCellTypes,
} from "./cell-registry";
import type { CellContext } from "./types";

function ctx(value: unknown): CellContext {
  return {
    value,
    row: {},
    column: { name: "x", header: "X" },
    viewType: "list",
  };
}

describe("cell-registry", () => {
  it("registers the core field types", () => {
    const types = getRegisteredCellTypes();
    for (const t of [
      "text",
      "email",
      "checkbox",
      "number",
      "date",
      "select",
      "radio",
      "chips",
      "relationship",
      "upload",
      "json",
      "richText",
      "textarea",
      "id",
      "slug",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("resolves a renderer by field type", () => {
    expect(getCellRenderer("date")).toBeTypeOf("function");
    expect(getCellRenderer("relationship")).toBeTypeOf("function");
  });

  it("returns undefined for unknown or missing types", () => {
    expect(getCellRenderer("no-such-type")).toBeUndefined();
    expect(getCellRenderer(undefined)).toBeUndefined();
  });

  it("lets a later registration override an earlier one (plugin override)", () => {
    const marker = () => "OVERRIDDEN";
    defineCellRenderer({
      id: "custom-text",
      types: ["text"],
      component: marker,
    });
    expect(getCellRenderer("text")).toBe(marker);
  });

  it("a renderer can register for multiple types at once", () => {
    const r = () => null;
    defineCellRenderer({ id: "multi", types: ["aaa", "bbb"], component: r });
    expect(getCellRenderer("aaa")).toBe(r);
    expect(getCellRenderer("bbb")).toBe(r);
  });

  it("core date renderer produces output for a valid date and a placeholder for null", () => {
    const dateR = getCellRenderer("date")!;
    expect(dateR(ctx("2026-03-01T12:00:00Z"))).toBeTruthy();
    expect(dateR(ctx(null))).toBeTruthy(); // renders the "-" placeholder element
  });
});

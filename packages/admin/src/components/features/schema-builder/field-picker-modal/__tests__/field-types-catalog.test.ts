// Why: lock the catalog contract so future drift (missing icon, wrong
// category, regressing on parity with the legacy palette) is caught in
// tests.
// - PR C restored toggle from the legacy palette; later removed since it
//   has no backend schema support (use checkbox instead).
// - PR C also drops the speculative `blocks` entry that has no editor.
import { describe, expect, it } from "vitest";

import { FIELD_TYPES_CATALOG } from "../field-types-catalog";

describe("FIELD_TYPES_CATALOG", () => {
  it("does NOT include toggle (removed — no backend schema support; use checkbox)", () => {
    expect(FIELD_TYPES_CATALOG.find(t => (t.type as string) === "toggle")).toBeUndefined();
  });

  it("does NOT include blocks (no editor exists for it)", () => {
    expect(FIELD_TYPES_CATALOG.find(t => (t.type as string) === "blocks")).toBeUndefined();
  });

  it("every entry carries an icon (Lucide name)", () => {
    for (const entry of FIELD_TYPES_CATALOG) {
      expect(entry.icon, `${entry.type} missing icon`).toBeTruthy();
      expect(typeof entry.icon).toBe("string");
    }
  });

  it("entries have unique types", () => {
    const types = FIELD_TYPES_CATALOG.map(t => t.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("at least one entry per category", () => {
    const cats = new Set(FIELD_TYPES_CATALOG.map(t => t.category));
    expect(cats.has("Basic")).toBe(true);
    expect(cats.has("Advanced")).toBe(true);
    expect(cats.has("Media")).toBe(true);
    expect(cats.has("Relational")).toBe(true);
    expect(cats.has("Structured")).toBe(true);
  });

  it("names the rich-text editor 'Editor' with a Lexical hint", () => {
    const richText = FIELD_TYPES_CATALOG.find(t => t.type === "richText");
    expect(richText).toBeDefined();
    expect(richText?.label).toBe("Editor");
    expect(richText?.hint).toMatch(/lexical/i);
  });
});

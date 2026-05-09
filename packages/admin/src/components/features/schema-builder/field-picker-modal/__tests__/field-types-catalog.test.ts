// Why: lock the catalog contract so future drift (missing icon, wrong
// category, regressing on parity with the legacy palette) is caught in
// tests. The legacy palette had `toggle`; PR C restores it. PR C also
// drops the speculative `blocks` entry that has no editor.
import { describe, expect, it } from "vitest";

import { FIELD_TYPES_CATALOG } from "../field-types-catalog";

describe("FIELD_TYPES_CATALOG", () => {
  it("includes toggle (restored from legacy palette)", () => {
    expect(FIELD_TYPES_CATALOG.find(t => t.type === "toggle")).toBeDefined();
  });

  it("does NOT include blocks (no editor exists for it)", () => {
    expect(FIELD_TYPES_CATALOG.find(t => t.type === "blocks")).toBeUndefined();
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

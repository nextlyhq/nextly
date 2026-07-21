/**
 * The same value reaches the client in different shapes depending on the
 * dialect and on whether it came from a live read or a stored snapshot, so the
 * normalizer is what lets display code assume one shape.
 */
import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { normalizeStoredValue } from "../normalize-stored-value";

function field(type: string, extra: Record<string, unknown> = {}): FieldConfig {
  return { name: "f", type, ...extra } as FieldConfig;
}

describe("normalizeStoredValue", () => {
  it("treats every absent encoding as a single empty case", () => {
    const text = field("text");
    expect(normalizeStoredValue(text, undefined)).toBeNull();
    expect(normalizeStoredValue(text, null)).toBeNull();
    expect(normalizeStoredValue(text, "")).toBeNull();
  });

  describe("checkbox", () => {
    it.each([
      [true, true],
      ["true", true],
      [1, true],
      ["1", true],
      [false, false],
      ["false", false],
      [0, false],
    ])("reads %p as %p", (stored, expected) => {
      // 0 and false normalize to false rather than to the empty case, so a
      // deliberate "no" is not displayed as "not set".
      expect(normalizeStoredValue(field("checkbox"), stored)).toBe(expected);
    });
  });

  describe("chips", () => {
    it("passes an array through", () => {
      expect(normalizeStoredValue(field("chips"), ["a", "b"])).toEqual([
        "a",
        "b",
      ]);
    });

    it("parses a JSON string, as stored on SQLite", () => {
      expect(normalizeStoredValue(field("chips"), '["a","b"]')).toEqual([
        "a",
        "b",
      ]);
    });

    it("treats an unparseable string as one entry, not as characters", () => {
      // The existing implementations disagree here; splitting a string into
      // characters is the failure this pins down.
      expect(normalizeStoredValue(field("chips"), "solo")).toEqual(["solo"]);
    });
  });

  describe("JSON-backed containers", () => {
    it("parses a repeater stored as a string", () => {
      expect(normalizeStoredValue(field("repeater"), '[{"a":1}]')).toEqual([
        { a: 1 },
      ]);
    });

    it("falls back to an empty list when a repeater will not parse", () => {
      expect(normalizeStoredValue(field("repeater"), "{oops")).toEqual([]);
    });

    it("parses a group stored as a string", () => {
      expect(normalizeStoredValue(field("group"), '{"a":1}')).toEqual({ a: 1 });
    });

    it("parses a hasMany value of any type", () => {
      const f = field("select", { hasMany: true });
      expect(normalizeStoredValue(f, '["x","y"]')).toEqual(["x", "y"]);
    });
  });

  describe("component", () => {
    it("unwraps the single instance of a non-repeatable component", () => {
      // Components are populated from their own table and always arrive as an
      // array, even when the field holds exactly one.
      expect(
        normalizeStoredValue(field("component"), [{ _componentType: "hero" }])
      ).toEqual({ _componentType: "hero" });
    });

    it("keeps the list for a repeatable component", () => {
      const f = field("component", { repeatable: true });
      expect(normalizeStoredValue(f, [{ a: 1 }, { a: 2 }])).toEqual([
        { a: 1 },
        { a: 2 },
      ]);
    });

    it("yields the empty case for a non-repeatable component with no instance", () => {
      expect(normalizeStoredValue(field("component"), [])).toBeNull();
    });
  });

  describe("number", () => {
    it("coerces a numeric string", () => {
      expect(normalizeStoredValue(field("number"), "42")).toBe(42);
    });

    it("yields the empty case for a non-numeric string", () => {
      expect(normalizeStoredValue(field("number"), "abc")).toBeNull();
    });

    it("keeps zero rather than treating it as empty", () => {
      expect(normalizeStoredValue(field("number"), 0)).toBe(0);
    });
  });

  describe("boolean alias", () => {
    it.each([
      [1, true],
      ["1", true],
      [true, true],
      [0, false],
    ])("normalizes the boolean alias, reading %p as %p", (stored, expected) => {
      // `boolean` is not in the config union but reaches display code as a
      // runtime alias for `checkbox`. Without normalizing it, a SQLite 1 would
      // fail the renderer's `=== true` check and display "No" for a true value.
      expect(normalizeStoredValue(field("boolean"), stored)).toBe(expected);
    });
  });

  it("leaves a plain text value untouched", () => {
    expect(normalizeStoredValue(field("text"), "hello")).toBe("hello");
  });
});

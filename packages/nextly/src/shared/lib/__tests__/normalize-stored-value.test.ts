/**
 * Guards the canonical stored-value normalizer. A version snapshot is captured
 * from the persisted row, so the same logical value arrives in several shapes
 * (JSON parsed vs string, boolean encodings, several "empty" spellings). Diffing
 * and display both read through here so two equal values never look different.
 */
import { describe, expect, it } from "vitest";

import { normalizeStoredValue } from "../normalize-stored-value";

describe("normalizeStoredValue", () => {
  it("parses a JSON-backed value that arrived as a string (SQLite)", () => {
    const field = { type: "chips" };
    expect(normalizeStoredValue(field, '["a","b"]')).toEqual(["a", "b"]);
    // Already-parsed on Postgres/MySQL must land on the same value.
    expect(normalizeStoredValue(field, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("parses a hasMany relationship stored as a JSON string", () => {
    const field = { type: "relationship", hasMany: true };
    expect(normalizeStoredValue(field, '["t1","t2"]')).toEqual(["t1", "t2"]);
    expect(normalizeStoredValue(field, ["t1", "t2"])).toEqual(["t1", "t2"]);
  });

  it("coerces every dialect boolean encoding to a real boolean", () => {
    const field = { type: "checkbox" };
    expect(normalizeStoredValue(field, 1)).toBe(true);
    expect(normalizeStoredValue(field, "1")).toBe(true);
    expect(normalizeStoredValue(field, true)).toBe(true);
    expect(normalizeStoredValue(field, 0)).toBe(false);
    expect(normalizeStoredValue(field, "0")).toBe(false);
  });

  it("maps every absent spelling to null so callers have one empty case", () => {
    const field = { type: "text" };
    expect(normalizeStoredValue(field, null)).toBeNull();
    expect(normalizeStoredValue(field, undefined)).toBeNull();
    expect(normalizeStoredValue(field, "")).toBeNull();
  });

  it("keeps an empty string for a json field (a legitimate stored primitive)", () => {
    const field = { type: "json" };
    expect(normalizeStoredValue(field, "")).toBe("");
  });

  it("unwraps a non-repeatable component populated as a one-element array", () => {
    const field = { type: "component" };
    const row = { id: "c1", _componentType: "seo" };
    expect(normalizeStoredValue(field, [row])).toEqual(row);
  });

  it("unwraps a non-repeatable field group the same way — either spelling", () => {
    // Both type tokens: unwrapping only the legacy one leaves the migrated
    // definition's array in place, and a nested diff would then read the
    // array — not the instance — as the value object.
    const row = { id: "c1", _fieldGroupType: "seo" };
    expect(normalizeStoredValue({ type: "fieldGroup" }, [row])).toEqual(row);
    expect(normalizeStoredValue({ type: "component" }, [row])).toEqual(row);
    // Repeatable stays a list under both.
    expect(
      normalizeStoredValue({ type: "fieldGroup", repeatable: true }, [row])
    ).toEqual([row]);
  });

  it("normalizes an absent many-valued field to an empty array", () => {
    // So an optional list omitted in one version and saved as [] in another
    // compare equal instead of null-vs-array.
    expect(normalizeStoredValue({ type: "chips" }, null)).toEqual([]);
    expect(
      normalizeStoredValue({ type: "text", hasMany: true }, undefined)
    ).toEqual([]);
    // A single-valued field is still null when absent.
    expect(normalizeStoredValue({ type: "text" }, null)).toBeNull();
  });

  it("coerces a numeric string to a number", () => {
    const field = { type: "number" };
    expect(normalizeStoredValue(field, "42")).toBe(42);
    expect(normalizeStoredValue(field, "not-a-number")).toBeNull();
  });
});

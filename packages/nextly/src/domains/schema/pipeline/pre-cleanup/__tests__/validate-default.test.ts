// Unit tests for validateDefaultValue.

import { describe, it, expect } from "vitest";

import { validateDefaultValue } from "../validate-default";

describe("validateDefaultValue", () => {
  it("accepts a valid string for text field", () => {
    const result = validateDefaultValue(
      { name: "email", type: "text" },
      "guest@example.com"
    );
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects non-string for text field", () => {
    const result = validateDefaultValue({ name: "email", type: "text" }, 42);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("accepts integer for number field", () => {
    const result = validateDefaultValue({ name: "age", type: "number" }, 18);
    expect(result.success).toBe(true);
  });

  it("rejects non-number for number field", () => {
    const result = validateDefaultValue({ name: "age", type: "number" }, "abc");
    expect(result.success).toBe(false);
  });

  it("accepts boolean for checkbox field", () => {
    const result = validateDefaultValue(
      { name: "active", type: "checkbox" },
      true
    );
    expect(result.success).toBe(true);
  });

  it("rejects non-boolean for checkbox field", () => {
    const result = validateDefaultValue(
      { name: "active", type: "checkbox" },
      "yes"
    );
    expect(result.success).toBe(false);
  });

  it("accepts ISO date string for date field", () => {
    const result = validateDefaultValue(
      { name: "published", type: "date" },
      "2026-04-28T00:00:00Z"
    );
    expect(result.success).toBe(true);
  });

  it("accepts Date object for date field", () => {
    const result = validateDefaultValue(
      { name: "published", type: "date" },
      new Date()
    );
    expect(result.success).toBe(true);
  });

  it("falls through to permissive for unknown types", () => {
    // Unknown field types pass without error so user-defined plugin types
    // don't block the apply.
    const result = validateDefaultValue(
      { name: "custom", type: "myCustomType" },
      { anything: "goes" }
    );
    expect(result.success).toBe(true);
  });

  it("accepts empty string for text field (caller decides if that's meaningful)", () => {
    const result = validateDefaultValue({ name: "email", type: "text" }, "");
    expect(result.success).toBe(true);
  });
});

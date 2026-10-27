/**
 * A text's length as a person counts it: in code points, not UTF-16 units.
 */
import { describe, expect, it } from "vitest";

import { textLength } from "../text-length";

describe("a text's length", () => {
  it("counts a character outside the Basic Multilingual Plane as one", () => {
    // 🔴 The must-differ case: `String.length` says 2 for each of these.
    expect("😀".length).toBe(2);
    expect(textLength("😀")).toBe(1);
    expect(textLength("a😀b")).toBe(3);
    expect(textLength("𝒜")).toBe(1);
  });

  it("counts plain text as `length` does, and nothing as zero", () => {
    expect(textLength("Notes")).toBe(5);
    expect(textLength("")).toBe(0);
  });
});

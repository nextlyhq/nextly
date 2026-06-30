import { describe, it, expect } from "vitest";
import { isValidRange, satisfiesRange } from "./semver-range";

describe("semver-range", () => {
  it("validates ranges, including multi-major", () => {
    expect(isValidRange("^1.0.0")).toBe(true);
    expect(isValidRange("^1 || ^2")).toBe(true);
    expect(isValidRange("not-a-range")).toBe(false);
  });

  it("treats prereleases as in-range (alpha core)", () => {
    expect(satisfiesRange("0.0.2-alpha.21", ">=0.0.2-alpha.0")).toBe(true);
    expect(satisfiesRange("0.0.2-alpha.21", ">=0.0.3")).toBe(false);
  });

  it("satisfies multi-major ranges", () => {
    expect(satisfiesRange("2.4.0", "^1 || ^2")).toBe(true);
    expect(satisfiesRange("3.0.0", "^1 || ^2")).toBe(false);
  });
});

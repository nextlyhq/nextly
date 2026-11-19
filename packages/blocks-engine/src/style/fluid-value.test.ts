import { describe, expect, it } from "vitest";

import { isFluidSize, isFluidSizes } from "./fluid-value";

describe("the sizes a fluid size is made from", () => {
  it("is a finite number of px above zero", () => {
    expect(isFluidSize(16)).toBe(true);
    expect(isFluidSize(0.5)).toBe(true);
    for (const size of [0, -4, Number.NaN, Infinity, -Infinity, "16", null]) {
      expect(isFluidSize(size), String(size)).toBe(false);
    }
  });

  it("are two such sizes, small and large, and nothing else", () => {
    expect(isFluidSizes({ small: 16, large: 32 })).toBe(true);
    for (const sizes of [
      { small: 16 },
      { small: 0, large: 32 },
      { small: 16, large: Infinity },
      { small: 16, large: 32, unit: "px" },
      [16, 32],
      "16 32",
      null,
    ]) {
      expect(isFluidSizes(sizes), JSON.stringify(sizes)).toBe(false);
    }
  });

  it("may shrink: a larger size on small screens is one the editor makes", () => {
    expect(isFluidSizes({ small: 32, large: 16 })).toBe(true);
  });
});

/**
 * What a length comes to at a page width, as the browser works it out, and
 * a fluid length's range.
 */
import { describe, expect, it } from "vitest";

import {
  fluidRange,
  fluidValue,
  nearestFluidSizes,
  pxAtWidth,
} from "./fluid-size";

describe("a length at a page width", () => {
  it("is a plain length as it is", () => {
    expect(pxAtWidth("20px", 1280)).toBe(20);
    expect(pxAtWidth("1.25rem", 1280)).toBe(20);
  });

  it("holds a clamp between its bounds, with a sum in its preferred term", () => {
    // 0.875rem + 0.5vw at 1280 is 20.4px, held to 1.25rem.
    expect(pxAtWidth("clamp(1rem, 0.875rem + 0.5vw, 1.25rem)", 1280)).toBe(20);
    expect(pxAtWidth("clamp(1rem, 0.875rem + 0.5vw, 1.25rem)", 320)).toBe(16);
    expect(pxAtWidth("clamp(1rem, 4vw, 3rem)", 800)).toBe(32);
  });

  it("lets the minimum win where it is larger than the maximum, as CSS does", () => {
    expect(pxAtWidth("clamp(32px, 2vw, 16px)", 1280)).toBe(32);
  });

  it("says nothing for what it cannot read", () => {
    expect(pxAtWidth("var(--x)", 1280)).toBeUndefined();
    expect(pxAtWidth("clamp(1rem, 50%, 2rem)", 1280)).toBeUndefined();
  });
});

describe("a fluid length's range", () => {
  it("is its clamp's bounds in px, and nothing for a plain length", () => {
    expect(fluidRange("clamp(1rem, 0.875rem + 0.5vw, 1.25rem)")).toEqual({
      minPx: 16,
      maxPx: 20,
    });
    expect(fluidRange("20px")).toBeUndefined();
  });
});

describe("a fluid size made from two sizes", () => {
  const range = { min: 360, max: 1280 };

  it("grows evenly across the range and stays at each end outside it", () => {
    const value = fluidValue({ small: 16, large: 20 }, range);
    const at = (width: number) => pxAtWidth(value, width) ?? Number.NaN;
    // 16 at 360, 20 at 1280, 18 halfway at 820; held at each end beyond.
    expect(at(320)).toBeCloseTo(16, 2);
    expect(at(360)).toBeCloseTo(16, 2);
    expect(at(820)).toBeCloseTo(18, 2);
    expect(at(1280)).toBeCloseTo(20, 2);
    expect(at(1600)).toBeCloseTo(20, 2);
    // And it reads back as the same two sizes.
    expect(fluidRange(value)).toEqual({ minPx: 16, maxPx: 20 });
  });

  it("shrinks as evenly where the large-screen size is the smaller", () => {
    const value = fluidValue({ small: 24, large: 16 }, range);
    expect(pxAtWidth(value, 820)).toBeCloseTo(20, 2);
    expect(pxAtWidth(value, 1600)).toBeCloseTo(16, 2);
    expect(pxAtWidth(value, 320)).toBeCloseTo(24, 2);
  });

  it("offers a hand-written fluid value's sizes at the range's two ends", () => {
    expect(
      nearestFluidSizes("clamp(1rem, 0.875rem + 0.5vw, 1.25rem)", range)
    ).toEqual({ small: 16, large: 20 });
    expect(nearestFluidSizes("var(--x)", range)).toBeUndefined();
  });
});

/**
 * What a length comes to at a page width, as the browser works it out, and
 * a fluid length's range.
 */
import { describe, expect, it } from "vitest";

import { fluidRange, pxAtWidth } from "./fluid-size";

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

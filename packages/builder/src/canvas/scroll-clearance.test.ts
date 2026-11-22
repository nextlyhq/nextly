/**
 * The toolbar's scroll clearance, composed with what the scroller already
 * keeps clear. jsdom's CSS parser drops a `max()` value, so the composed
 * string is asserted here rather than read back from an element.
 *
 * @module scroll-clearance.test
 */
import { describe, expect, it } from "vitest";

import { clearanceWith } from "./scroll-clearance";

describe("clearanceWith", () => {
  it("is the bar's height where the scroller keeps nothing clear", () => {
    expect(clearanceWith("", 46)).toBe("46px");
    expect(clearanceWith("auto", 46)).toBe("46px");
  });

  it("takes the larger number of pixels", () => {
    expect(clearanceWith("80px", 46)).toBe("80px");
    expect(clearanceWith("0px", 46)).toBe("46px");
  });

  it("asks the browser for the larger where the scroller's is not in pixels", () => {
    // Read as a number, 10% would be 10px and calc() nothing at all.
    expect(clearanceWith("10%", 46)).toBe("max(10%, 46px)");
    expect(clearanceWith("calc(2rem + 8px)", 46)).toBe(
      "max(calc(2rem + 8px), 46px)"
    );
  });
});

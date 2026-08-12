/**
 * A saturation square cannot be checked by rendering it: jsdom reports every
 * element as zero-sized, so a component test measures nothing and passes
 * whatever the mapping does. The corners are asserted here instead, where the
 * arithmetic is visible.
 *
 * The axis inversion is the property worth guarding. A picker that runs value
 * the wrong way looks entirely correct — a gradient, a handle that follows the
 * cursor — and selects the colour mirrored vertically from the one under it.
 */
import { describe, expect, it } from "vitest";

import {
  hueAt,
  huePosition,
  pointOnSurface,
  saturationValueAt,
  surfacePointFor,
} from "./picker-geometry";

const RECT = { left: 100, top: 50, width: 200, height: 100 };

describe("a pointer on the surface", () => {
  it("reads the corners as fractions", () => {
    expect(pointOnSurface(100, 50, RECT)).toEqual({ x: 0, y: 0 });
    expect(pointOnSurface(300, 150, RECT)).toEqual({ x: 1, y: 1 });
    expect(pointOnSurface(200, 100, RECT)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps a drag that left the surface", () => {
    // The interaction people actually use to reach a corner: press inside,
    // drag past the edge. Unclamped this yields values outside the colour
    // space rather than the corner they are aiming at.
    expect(pointOnSurface(-500, -500, RECT)).toEqual({ x: 0, y: 0 });
    expect(pointOnSurface(9999, 9999, RECT)).toEqual({ x: 1, y: 1 });
  });

  it("answers the top-left for a zero-sized surface", () => {
    // Before layout, and in every jsdom test. Dividing by zero here yields NaN,
    // which propagates into the colour and renders as nothing at all.
    const collapsed = { left: 0, top: 0, width: 0, height: 0 };
    expect(pointOnSurface(10, 10, collapsed)).toEqual({ x: 0, y: 0 });
  });
});

describe("saturation and value", () => {
  it("runs value UPWARD while y runs downward", () => {
    // The separating case. If both axes ran the same way, x would still map
    // correctly and only this assertion would notice.
    expect(saturationValueAt({ x: 0, y: 0 })).toEqual({ s: 0, v: 1 });
    expect(saturationValueAt({ x: 1, y: 1 })).toEqual({ s: 1, v: 0 });
  });

  it("round-trips through the handle position", () => {
    // Derived rather than restated: the inverse must agree with the forward
    // mapping about which way the axis runs, and a round trip is the only
    // assertion that fails when one of them is flipped alone.
    for (const [s, v] of [
      [0, 0],
      [1, 1],
      [0.25, 0.75],
    ]) {
      expect(saturationValueAt(surfacePointFor(s, v))).toEqual({ s, v });
    }
  });
});

describe("hue", () => {
  it("spans the strip", () => {
    expect(hueAt(0)).toBe(0);
    expect(hueAt(0.5)).toBe(180);
  });

  it("wraps the far end to 0 rather than 360", () => {
    // 360 and 0 are the same hue, but a handle placed at 360 reads back as a
    // position off the end of the strip.
    expect(hueAt(1)).toBe(0);
    expect(huePosition(360)).toBe(0);
    expect(huePosition(-90)).toBe(0.75);
  });
});

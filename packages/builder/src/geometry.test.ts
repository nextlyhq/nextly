import { describe, expect, it } from "vitest";

import {
  FrameGeometryError,
  pointToCanvas,
  pointToHost,
  rectToHost,
  type FrameGeometry,
} from "./geometry";

/** A frame offset from the host origin and zoomed out, so neither term is 1 or 0. */
const FRAME: FrameGeometry = { origin: { x: 120, y: 64 }, scale: 0.5 };

/** The unscaled, unoffset case, which must not be the only one that works. */
const IDENTITY: FrameGeometry = { origin: { x: 0, y: 0 }, scale: 1 };

describe("mapping a point across the frame", () => {
  it("places a canvas point where the host sees it", () => {
    expect(pointToHost({ x: 40, y: 20 }, FRAME)).toEqual({ x: 140, y: 74 });
  });

  it("places a host point where the canvas sees it", () => {
    expect(pointToCanvas({ x: 140, y: 74 }, FRAME)).toEqual({ x: 40, y: 20 });
  });

  it.each<[string, FrameGeometry]>([
    ["offset and scaled", FRAME],
    ["identity", IDENTITY],
    ["scaled up", { origin: { x: -30, y: 12 }, scale: 2 }],
    ["fractional scale", { origin: { x: 7.5, y: 0.25 }, scale: 1.75 }],
  ])("round-trips a point unchanged: %s", (_label, frame) => {
    const point = { x: 37, y: 91 };
    expect(pointToCanvas(pointToHost(point, frame), frame)).toEqual(point);
  });

  it("is not satisfied by returning its input", () => {
    // The control for the round trip above, which a pair of identity functions
    // would pass. At any scale or offset other than the identity the mapped
    // point has to differ from the one given.
    expect(pointToHost({ x: 40, y: 20 }, FRAME)).not.toEqual({ x: 40, y: 20 });
  });
});

describe("mapping a rectangle across the frame", () => {
  it("scales the size, not only the position", () => {
    // An overlay sized from the unscaled rectangle is correct at 100% and wrong
    // everywhere else — and 100% is where it gets looked at.
    expect(rectToHost({ x: 40, y: 20, width: 200, height: 80 }, FRAME)).toEqual(
      {
        x: 140,
        y: 74,
        width: 100,
        height: 40,
      }
    );
  });

  it("leaves a rectangle alone under the identity frame", () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(rectToHost(rect, IDENTITY)).toEqual(rect);
  });
});

describe("a frame that describes no mapping", () => {
  it.each<[string, FrameGeometry]>([
    ["zero scale", { origin: { x: 0, y: 0 }, scale: 0 }],
    ["negative scale", { origin: { x: 0, y: 0 }, scale: -1 }],
    [
      "infinite scale",
      { origin: { x: 0, y: 0 }, scale: Number.POSITIVE_INFINITY },
    ],
    ["NaN scale", { origin: { x: 0, y: 0 }, scale: Number.NaN }],
    ["NaN origin", { origin: { x: Number.NaN, y: 0 }, scale: 1 }],
  ])("refuses rather than mapping to nowhere: %s", (_label, frame) => {
    // Each of these has a plausible-looking answer — a point, a mirror image,
    // `NaN` — and every one of them puts the overlay somewhere wrong without
    // reporting anything.
    expect(() => pointToHost({ x: 1, y: 1 }, frame)).toThrow(
      FrameGeometryError
    );
    expect(() => pointToCanvas({ x: 1, y: 1 }, frame)).toThrow(
      FrameGeometryError
    );
    expect(() =>
      rectToHost({ x: 1, y: 1, width: 1, height: 1 }, frame)
    ).toThrow(FrameGeometryError);
  });
});

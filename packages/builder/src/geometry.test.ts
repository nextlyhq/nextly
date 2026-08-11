import { describe, expect, it } from "vitest";

import {
  FrameGeometryError,
  frameContentOrigin,
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

describe("locating the frame's content viewport", () => {
  it("scales the border inset with the frame", () => {
    // The separating case, and the only one that distinguishes a correct
    // implementation from adding the inset raw: a 4px border at 50% occupies 2
    // host pixels, so the content starts at 100 + 2 rather than 100 + 4.
    expect(
      frameContentOrigin({ x: 100, y: 50 }, { left: 4, top: 8 }, 0.5)
    ).toEqual({ x: 102, y: 54 });
  });

  it("agrees with adding the inset raw only at 100%", () => {
    // Why the fault survived review: at scale 1 the two implementations are the
    // same function, and 100% is the state a canvas is developed in.
    expect(
      frameContentOrigin({ x: 100, y: 50 }, { left: 4, top: 8 }, 1)
    ).toEqual({ x: 104, y: 58 });
  });

  it("leaves the origin alone when the frame has no border", () => {
    // The fixture case. It passes whether or not the inset is scaled, which is
    // precisely why it could not have caught this.
    expect(
      frameContentOrigin({ x: 100, y: 50 }, { left: 0, top: 0 }, 0.5)
    ).toEqual({ x: 100, y: 50 });
  });

  it("feeds a geometry that maps a content-relative point correctly", () => {
    // The reason the correction exists at all: a rectangle read INSIDE the frame
    // is relative to the content viewport, so the origin it is added to has to
    // be the content corner. Composing the two here is what a caller does.
    const origin = frameContentOrigin(
      { x: 100, y: 50 },
      { left: 4, top: 8 },
      0.5
    );
    expect(pointToHost({ x: 20, y: 10 }, { origin, scale: 0.5 })).toEqual({
      x: 112,
      y: 59,
    });
  });

  it.each([
    ["zero scale", 0, { left: 1, top: 1 }],
    ["negative scale", -1, { left: 1, top: 1 }],
    ["NaN scale", Number.NaN, { left: 1, top: 1 }],
    ["NaN inset", 1, { left: Number.NaN, top: 1 }],
    ["infinite inset", 1, { left: 1, top: Number.POSITIVE_INFINITY }],
  ])(
    "refuses an unusable measurement rather than returning one: %s",
    (_label, scale, inset) => {
      expect(() => frameContentOrigin({ x: 0, y: 0 }, inset, scale)).toThrow(
        FrameGeometryError
      );
    }
  );
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

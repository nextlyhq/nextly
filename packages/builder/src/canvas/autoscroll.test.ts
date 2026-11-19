/**
 * The autoscroll speed curve.
 *
 * Asserted here rather than through the drag, because every rectangle in jsdom
 * is zero: a curve computed inside a component is a curve no test can see. These
 * cases feed the function the coordinates a real canvas would produce.
 *
 * @module autoscroll.test
 */
import { describe, expect, it } from "vitest";

import {
  AUTOSCROLL_MAX_STEP_PX,
  AUTOSCROLL_ZONE_PX,
  autoscrollStep,
} from "./autoscroll";

/** A canvas 600px tall, sitting 100px down the viewport. */
const TOP = 100;
const BOTTOM = 700;

function step(pointerY: number): number {
  return autoscrollStep(pointerY, TOP, BOTTOM);
}

describe("autoscrollStep", () => {
  it("does not scroll while the pointer is away from both edges", () => {
    expect(step(400)).toBe(0);
  });

  it("scrolls UP near the top and DOWN near the bottom", () => {
    // The sign carries the direction, so a caller adding it to `scrollTop`
    // needs no branch of its own.
    expect(step(TOP + 10)).toBeLessThan(0);
    expect(step(BOTTOM - 10)).toBeGreaterThan(0);
  });

  it("does nothing at the band's inner boundary, and moves just inside it", () => {
    // THE case for a proportional curve. A constant speed would jump from
    // nothing to full at this line, and the author would have no slow end.
    expect(step(TOP + AUTOSCROLL_ZONE_PX)).toBe(0);
    expect(Math.abs(step(TOP + AUTOSCROLL_ZONE_PX - 1))).toBeGreaterThan(0);
  });

  it("speeds up the deeper into the band the pointer goes", () => {
    const shallow = Math.abs(step(TOP + 50));
    const middle = Math.abs(step(TOP + 30));
    const deep = Math.abs(step(TOP + 5));

    expect(middle).toBeGreaterThan(shallow);
    expect(deep).toBeGreaterThan(middle);
  });

  it("reaches full speed at the rim", () => {
    expect(step(TOP)).toBeCloseTo(-AUTOSCROLL_MAX_STEP_PX);
    expect(step(BOTTOM)).toBeCloseTo(AUTOSCROLL_MAX_STEP_PX);
  });

  it("clamps past the edge instead of accelerating without bound", () => {
    // A drag captures the pointer, so it reports positions from outside the
    // container. Letting those scale would make the speed depend on how far
    // outside the window a hand happens to be.
    expect(step(TOP - 500)).toBeCloseTo(-AUTOSCROLL_MAX_STEP_PX);
    expect(step(BOTTOM + 500)).toBeCloseTo(AUTOSCROLL_MAX_STEP_PX);
  });

  it("is symmetric: the same depth scrolls at the same rate either way", () => {
    expect(Math.abs(step(TOP + 12))).toBeCloseTo(Math.abs(step(BOTTOM - 12)));
  });
});

describe("a container too short for two full bands", () => {
  /** 80px tall — shorter than twice the 64px band. */
  const SHORT_TOP = 0;
  const SHORT_BOTTOM = 80;

  function shortStep(pointerY: number): number {
    return autoscrollStep(pointerY, SHORT_TOP, SHORT_BOTTOM);
  }

  it("keeps a still point in the middle rather than scrolling both ways", () => {
    // Without shrinking the band, the midpoint sits inside BOTH, and whichever
    // is tested first wins — a canvas that scrolls in whichever direction the
    // code happened to check.
    expect(shortStep(40)).toBe(0);
  });

  it("still scrolls each way from its own half", () => {
    // The control: shrinking the band must not disable the feature on a short
    // container, only stop the two halves overlapping.
    expect(shortStep(5)).toBeLessThan(0);
    expect(shortStep(75)).toBeGreaterThan(0);
  });
});

describe("degenerate inputs", () => {
  it("answers 0 for a container with no height", () => {
    // A collapsed panel has no inside, so no position within it is near an
    // edge. Dividing by that height is what this avoids.
    expect(autoscrollStep(100, 300, 300)).toBe(0);
    expect(autoscrollStep(100, 400, 300)).toBe(0);
  });

  it("answers 0 when the band or the speed is switched off", () => {
    expect(autoscrollStep(TOP, TOP, BOTTOM, 0)).toBe(0);
    expect(autoscrollStep(TOP, TOP, BOTTOM, AUTOSCROLL_ZONE_PX, 0)).toBe(0);
  });
});

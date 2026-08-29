/**
 * The zoom model, which is the half the canvas cannot check.
 *
 * The canvas decides what a scale DOES to the box. What is only true here is
 * that a chosen scale survives a round trip through storage, that a value
 * storage should never have held is refused rather than painted, and that
 * stepping from Fit starts where the author is looking.
 *
 * @module canvas-zoom.test
 */
import { describe, expect, it } from "vitest";

import {
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  readZoom,
  steppedZoom,
  writeZoom,
} from "./canvas-zoom";

describe("a zoom read back from storage", () => {
  it("round-trips both kinds", () => {
    // Asserted through the pair rather than against a literal, so a change to
    // how a zoom is written cannot pass by changing both sides at once.
    expect(readZoom(writeZoom(FIT_ZOOM))).toEqual(FIT_ZOOM);
    expect(readZoom(writeZoom({ kind: "fixed", scale: 1.5 }))).toEqual({
      kind: "fixed",
      scale: 1.5,
    });
  });

  it("refuses a value that would paint the canvas out of reach", () => {
    /*
     * A stored value can come from a later version, a hand-edited preference,
     * or a bug. Below the floor the page is illegible and above the ceiling one
     * block fills the region, and in both cases the author has no way back
     * except to find the control they can no longer see.
     */
    expect(readZoom(MIN_ZOOM / 2)).toBeNull();
    expect(readZoom(MAX_ZOOM * 2)).toBeNull();
    // The bounds themselves are inside, or the guard rejects what it names.
    expect(readZoom(MIN_ZOOM)).toEqual({ kind: "fixed", scale: MIN_ZOOM });
    expect(readZoom(MAX_ZOOM)).toEqual({ kind: "fixed", scale: MAX_ZOOM });
  });

  it("refuses what is not a scale at all", () => {
    // `null` rather than a quiet fall back to fit: a caller restoring
    // preferences needs to know it found nothing, and a fixed scale that
    // silently became fit reads as the editor forgetting the author's choice.
    for (const value of [undefined, null, "1.5", Number.NaN, Infinity, {}]) {
      expect(readZoom(value)).toBeNull();
    }
  });
});

describe("stepping the zoom", () => {
  it("steps off the scale the author is LOOKING at, not off the list", () => {
    /*
     * From Fit there is no stored number to step from, and the fit scale is
     * the only one that describes what is on screen. Stepping from an end of
     * the list instead would jump the canvas somewhere unrelated on the first
     * press — the gesture that is supposed to be the smallest possible change.
     */
    expect(steppedZoom(FIT_ZOOM, 0.6, "in")).toEqual({
      kind: "fixed",
      scale: 0.75,
    });
    expect(steppedZoom(FIT_ZOOM, 0.6, "out")).toEqual({
      kind: "fixed",
      scale: 0.5,
    });
  });

  it("stays put at the ends rather than wrapping", () => {
    const largest = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    const smallest = ZOOM_STEPS[0];
    if (largest === undefined || smallest === undefined) {
      throw new Error("expected steps");
    }
    const top = { kind: "fixed", scale: largest } as const;
    const bottom = { kind: "fixed", scale: smallest } as const;
    // Wrapping would take a press meant to magnify and shrink the page to its
    // smallest, which is the opposite of what was asked for.
    expect(steppedZoom(top, 1, "in")).toEqual(top);
    expect(steppedZoom(bottom, 1, "out")).toEqual(bottom);
  });

  it("does not stall on the step it is already at", () => {
    // Exact equality against a float is the case a naive `>=` gets wrong: at
    // 100% a press to magnify must reach 150%, not answer 100% again.
    expect(steppedZoom({ kind: "fixed", scale: 1 }, 1, "in")).toEqual({
      kind: "fixed",
      scale: 1.5,
    });
    expect(steppedZoom({ kind: "fixed", scale: 1 }, 1, "out")).toEqual({
      kind: "fixed",
      scale: 0.75,
    });
  });
});

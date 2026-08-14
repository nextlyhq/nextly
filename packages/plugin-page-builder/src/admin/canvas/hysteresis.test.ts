import { describe, expect, it } from "vitest";

import {
  TARGET_SWITCH_BAND_CENTRE_DELTA_PX,
  bandedValue,
  centreDistance,
} from "./hysteresis";

/** Two equal zones stacked vertically, centres `ZONE` apart, boundary midway. */
const ZONE = 40;

/**
 * Which zone owns the pointer at `x` pixels past the boundary, decided the way
 * the library decides it: higher value wins.
 *
 * The winner is DERIVED from `bandedValue` rather than from a second copy of
 * the switching rule. A helper that re-expressed the rule as
 * `dIncumbent - dChallenger >= band` would agree with the implementation on the
 * day it was written and drift afterwards, and the drift would be invisible
 * because both halves would look correct.
 */
function ownerAt(x: number, band: number): "incumbent" | "challenger" {
  const pointer = { x: 0, y: x };
  const incumbent = centreDistance({ x: 0, y: -ZONE / 2 }, pointer);
  const challenger = centreDistance({ x: 0, y: ZONE / 2 }, pointer);
  const incumbentValue = bandedValue(1 / incumbent, incumbent, band);
  const challengerValue = 1 / challenger;
  return challengerValue > incumbentValue ? "challenger" : "incumbent";
}

/** The pointer offset at which ownership actually changes, to 0.01px. */
function measuredSwitchPx(band: number): number {
  for (let step = 0; step <= ZONE * 100; step += 1) {
    const x = step / 100;
    if (ownerAt(x, band) === "challenger") return x;
  }
  return Number.POSITIVE_INFINITY;
}

describe("target-switch hysteresis", () => {
  it("holds the incumbent through jitter that crosses the boundary", () => {
    // The defect: with the pointer resting near a boundary, ownership flipped on
    // every 2px crossing and the insertion line strobed between two targets.
    for (const x of [2, -2, 2, -2, 2, -2]) {
      expect(ownerAt(x, TARGET_SWITCH_BAND_CENTRE_DELTA_PX)).toBe("incumbent");
    }
  });

  it("gives up the incumbent once the pointer commits", () => {
    // The positive control. Without it every assertion here is satisfied by a
    // rule that never switches at all, which is not hysteresis but paralysis.
    expect(ownerAt(ZONE / 2, TARGET_SWITCH_BAND_CENTRE_DELTA_PX)).toBe(
      "challenger"
    );
  });

  it("resists for 8-12px of POINTER movement, measured not converted", () => {
    // The requirement is in pixels of pointer movement; the constant is in
    // difference-of-centre-distances, and the two differ by a factor of two
    // because the pointer recedes from one centre while approaching the other.
    //
    // So the width is measured from the implementation's own decisions rather
    // than computed from the constant. Asserting `band / 2` here would restate
    // the conversion the implementation uses, and the pair would be wrong
    // together: a constant of 10 reads as "10px" and delivers 5px, which is
    // under the requirement's floor while appearing to sit inside its range.
    const achieved = measuredSwitchPx(TARGET_SWITCH_BAND_CENTRE_DELTA_PX);

    expect(achieved).toBeGreaterThanOrEqual(8);
    expect(achieved).toBeLessThanOrEqual(12);
  });

  it("is monotonic in the band: a wider band resists further", () => {
    // Guards the direction of the scaling. A reciprocal applied the wrong way
    // round still produces a switch point, and still passes a single-value
    // range check if the number happens to land inside it.
    const narrow = measuredSwitchPx(8);
    const wide = measuredSwitchPx(32);

    expect(wide).toBeGreaterThan(narrow);
  });

  it("switches immediately when there is no band", () => {
    // The zero-band control establishes that the resistance above comes from the
    // band and not from the geometry of the fixture: at the boundary the two
    // distances are equal, so any positive offset must hand over at once.
    expect(measuredSwitchPx(0)).toBeLessThanOrEqual(0.01);
  });
});

describe("bandedValue at the edges", () => {
  it("leaves an unbeatable score unbeatable", () => {
    // Pointer containment reports exactly Infinity when the pointer sits on a
    // centre, with no guard of its own. Scaling it would return a finite number,
    // so the incumbent would LOSE at the one position where it is most clearly
    // the right target — the band inverting exactly where it should be
    // strongest, with nothing in the symptom pointing at the clamp.
    expect(bandedValue(Number.POSITIVE_INFINITY, 0, 20)).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it("never returns a negative or NaN value inside the band", () => {
    // A negative divisor inverts the ranking, and NaN makes the comparator's
    // ordering undefined. Both are silent.
    for (const distance of [0.5, 5, 19, 19.999, 20]) {
      const value = bandedValue(1 / distance, distance, 20);
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("weakens the incumbent by distance, not by a constant", () => {
    // The property that separates this from adding a bonus: the same band moves
    // the value by different amounts at different distances, because the value
    // is an inverse. Equal deltas would mean the band buys a pixel width that
    // varies with how far the pointer already is.
    const near = bandedValue(1 / 30, 30, 20) - 1 / 30;
    const far = bandedValue(1 / 100, 100, 20) - 1 / 100;

    expect(near).toBeGreaterThan(far);
  });

  it("returns the base value when the band is absent or nonsensical", () => {
    expect(bandedValue(0.25, 40, 0)).toBe(0.25);
    expect(bandedValue(0.25, 40, -5)).toBe(0.25);
    expect(bandedValue(0.25, Number.NaN, 20)).toBe(0.25);
  });
});

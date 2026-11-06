/**
 * The bar arithmetic, asked the questions a rendered chart cannot answer.
 *
 * jsdom performs no layout, so a bar that overflows its track and one that
 * divides by zero render identically to a correct one. These assertions are on
 * the numbers for that reason.
 */

import { describe, expect, it } from "vitest";

import { barFractions } from "../chart-scale";

describe("bar lengths", () => {
  it("gives the largest bucket the full track", () => {
    expect(barFractions([5, 10, 1])).toEqual([0.5, 1, 0.1]);
  });

  it("draws nothing rather than dividing by zero when every bucket is empty", () => {
    // A real first-day dashboard: the collection exists and has no rows. The
    // defect this catches is `0/0`, which is NaN and reaches the DOM as a
    // width of "NaN%" -- a bar of unpredictable length rather than none.
    expect(barFractions([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("keeps a bar inside its track whatever arrives", () => {
    // Every fraction is a width, so one above 1 overflows the card and one
    // below 0 inverts the bar. Neither can come from a count today, which is
    // exactly why nothing else would catch it.
    for (const fraction of barFractions([-4, 0, 7, Number.NaN, Infinity])) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it("has no bars for no buckets", () => {
    expect(barFractions([])).toEqual([]);
  });
});

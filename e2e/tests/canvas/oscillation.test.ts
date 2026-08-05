/**
 * Unit tests for the drop-target oscillation detector.
 *
 * Pure functions, no browser. They live under the Playwright runner because it
 * is the only test runner this package has; adding a second one to hold seven
 * assertions would cost more than it returns.
 */
import { expect, test } from "@playwright/test";

import { findReversal } from "./oscillation";

test("findReversal accepts a strictly advancing sequence", () => {
  expect(findReversal([0, 1, 2, 3])).toBeNull();
});

test("findReversal accepts a sequence that pauses on one target", () => {
  expect(findReversal([0, 0, 1, 1, 1, 2])).toBeNull();
});

test("findReversal accepts a sequence that only ever retreats", () => {
  expect(findReversal([5, 4, 4, 3])).toBeNull();
});

test("findReversal reports the first reversal in an advancing sequence", () => {
  expect(findReversal([0, 1, 2, 1, 2, 3])).toEqual({
    index: 3,
    from: 2,
    to: 1,
  });
});

test("findReversal reports the first reversal in a retreating sequence", () => {
  expect(findReversal([5, 4, 5])).toEqual({ index: 2, from: 4, to: 5 });
});

/**
 * -1 means no zone was active. It occurs legitimately at the start and end of
 * every drag and over an invalid target, so treating it as a value would invent
 * reversals that never happened.
 */
test("findReversal ignores samples with no active target", () => {
  expect(findReversal([-1, 0, -1, 1, 2, -1])).toBeNull();
});

/** Skipping those samples must not let a real reversal hide behind one. */
test("findReversal reports a reversal that spans a gap with no active target", () => {
  expect(findReversal([0, 1, -1, 0])).toEqual({ index: 3, from: 1, to: 0 });
});

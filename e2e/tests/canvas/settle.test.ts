/**
 * Unit tests for the settling reader every other probe in this suite is judged
 * with.
 *
 * It earns its own tests because it occupies the position the auditing is done
 * from: when it reports a stale value as settled, every assertion built on it
 * fails or passes for a reason that has nothing to do with the canvas, and
 * nothing else in the suite is standing far enough out to notice.
 *
 * No browser. They live under the Playwright runner because it is the only test
 * runner this package has, matching `oscillation.test.ts`.
 */
import { expect, test } from "@playwright/test";

import { DWELL_ALLOWANCE_MS, settledValue } from "./driver";

/**
 * A reader that behaves like a canvas whose hysteresis is a dwell TIMER: it
 * keeps answering with the previous value for `dwellMs` after the pointer moved,
 * then commits to the new one.
 *
 * This is a COMPLIANT canvas, not a broken one. The requirement permits
 * hysteresis expressed as a dwell of up to {@link DWELL_ALLOWANCE_MS} instead of
 * a distance margin, so every assertion below is about the harness reading such
 * a canvas correctly rather than about the canvas being right.
 */
function dwellingReader(
  before: number,
  after: number,
  dwellMs: number
): () => Promise<number> {
  const movedAt = Date.now();
  return async () => (Date.now() - movedAt < dwellMs ? before : after);
}

test("returns the value the reader commits to, not the one it is still lagging on", async () => {
  // The defect this replaced: "settled" meant "two consecutive reads agreed".
  // During a permitted dwell every read agrees, and they all return the
  // PRE-move value — so the old reader returned 1 here and each caller compared
  // a stale target against where the pointer actually was.
  expect(await settledValue(dwellingReader(1, 2, DWELL_ALLOWANCE_MS / 2))).toBe(
    2
  );
});

test("spends the whole allowance before calling an unchanged value settled", async () => {
  // The cost is the point rather than a side effect: a canvas answering
  // immediately and a canvas that has not yet changed its mind are
  // indistinguishable until the interval it was permitted to lag for has
  // passed. Any implementation that returns sooner is guessing.
  const started = Date.now();
  expect(await settledValue(async () => 3)).toBe(3);
  expect(Date.now() - started).toBeGreaterThanOrEqual(DWELL_ALLOWANCE_MS);
});

test("throws rather than returning a value from a reader that never holds still", async () => {
  // A number handed back from a canvas still changing its mind is one no
  // assertion downstream can qualify. Returning it silently would let an
  // unstable canvas produce an ordinary-looking green, which is the failure
  // this whole file exists to prevent.
  let next = 0;
  await expect(
    settledValue(async () => {
      next += 1;
      return next;
    }, "test reading")
  ).rejects.toThrow(/test reading was still changing/);
});

test("tolerates a reader that settles only after changing more than once", async () => {
  // A canvas is entitled to a dwell, and to another if the first expiry moves
  // the target somewhere that starts a second. A harness that accepted only one
  // transition would fail a compliant canvas, which is the error this suite has
  // made four times in other probes.
  const movedAt = Date.now();
  const step = DWELL_ALLOWANCE_MS / 2;
  const value = await settledValue(async () => {
    const elapsed = Date.now() - movedAt;
    if (elapsed < step) return 1;
    if (elapsed < step * 2) return 2;
    return 3;
  });
  expect(value).toBe(3);
});

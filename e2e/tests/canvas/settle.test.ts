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

import {
  DEFAULT_DWELL_ALLOWANCE_MS,
  PERMITTED_DWELL_FLOOR_MS,
  settledTarget,
  settledValue,
} from "./driver";

/**
 * A reader that behaves like a canvas whose hysteresis is a dwell TIMER: it
 * keeps answering with the previous value for `dwellMs` after the pointer moved,
 * then commits to the new one.
 *
 * This is a COMPLIANT canvas, not a broken one. The requirement permits
 * hysteresis expressed as a dwell of up to {@link DEFAULT_DWELL_ALLOWANCE_MS} instead of
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
  // Two consecutive identical reads do not establish settlement: during a
  // permitted dwell every read agrees, and all of them return the PRE-move
  // value. Only stability observed across the whole allowance separates a
  // canvas that has committed from one still entitled to lag.
  expect(
    await settledValue(
      dwellingReader(1, 2, DEFAULT_DWELL_ALLOWANCE_MS / 2),
      DEFAULT_DWELL_ALLOWANCE_MS
    )
  ).toBe(2);
});

test("spends the whole allowance before calling an unchanged value settled", async () => {
  // The cost is the point rather than a side effect: a canvas answering
  // immediately and a canvas that has not yet changed its mind are
  // indistinguishable until the interval it was permitted to lag for has
  // passed. Any implementation that returns sooner is guessing.
  const started = Date.now();
  expect(await settledValue(async () => 3, DEFAULT_DWELL_ALLOWANCE_MS)).toBe(3);
  expect(Date.now() - started).toBeGreaterThanOrEqual(
    DEFAULT_DWELL_ALLOWANCE_MS
  );
});

test("throws rather than returning a value from a reader that never holds still", async () => {
  // A number handed back from a canvas still changing its mind is one no
  // assertion downstream can qualify. Returning it silently would let an
  // unstable canvas produce an ordinary-looking green, which is the failure
  // this whole file exists to prevent.
  let next = 0;
  await expect(
    settledValue(
      async () => {
        next += 1;
        return next;
      },
      DEFAULT_DWELL_ALLOWANCE_MS,
      "test reading"
    )
  ).rejects.toThrow(/test reading changed more than \d+ times/);
});

test("tolerates a reader that settles only after changing more than once", async () => {
  // A canvas is entitled to a dwell, and to another if the first expiry moves
  // the target somewhere that starts a second. A reader that accepted only one
  // transition would return the intermediate value and call it settled.
  const movedAt = Date.now();
  const step = DEFAULT_DWELL_ALLOWANCE_MS / 2;
  const value = await settledValue(async () => {
    const elapsed = Date.now() - movedAt;
    if (elapsed < step) return 1;
    if (elapsed < step * 2) return 2;
    return 3;
  }, DEFAULT_DWELL_ALLOWANCE_MS);
  expect(value).toBe(3);
});

test("reads a canvas whose dwell sits ABOVE the permitted floor", async () => {
  // The requirement is "a dwell of MORE than 100ms", so the floor is the
  // smallest dwell a compliant canvas may use, not the largest. Waiting only
  // the floor returns the pre-move value for every canvas that clears the bar
  // it was told to clear — the more correct the implementation, the more
  // reliably the harness misread it.
  //
  // This is the case that separates the two constants: with one shared value
  // the settling wait equals the floor and this fails.
  expect(
    await settledValue(
      dwellingReader(1, 2, PERMITTED_DWELL_FLOOR_MS + 50),
      DEFAULT_DWELL_ALLOWANCE_MS
    )
  ).toBe(2);
});

test("honours a dwell the driver declares to be longer than the default", async () => {
  // The requirement sets no upper bound on a permitted dwell, so no global
  // constant can be right for every canvas. A driver that dwells longer than
  // the default says so, and the settling helper takes ITS figure — with a
  // shared constant this returns the pre-move value.
  //
  // Trusting the driver here is safe because understating the dwell is
  // self-punishing: readings come back stale and the suite fails. The jitter
  // probe deliberately does NOT trust it, because that probe grades whether
  // hysteresis exists at all.
  const slow = DEFAULT_DWELL_ALLOWANCE_MS + 200;
  const read = dwellingReader(1, 2, slow - 50);

  expect(
    await settledTarget({ dwellAllowanceMs: slow, readActiveTarget: read })
  ).toBe(2);
});

test("takes the default for a driver that declares no dwell", async () => {
  // The capability is optional, so a driver written before it existed keeps
  // working rather than silently settling with a zero allowance.
  const read = dwellingReader(1, 2, DEFAULT_DWELL_ALLOWANCE_MS / 2);

  expect(await settledTarget({ readActiveTarget: read })).toBe(2);
});

test("tolerates a change when the driver declares no dwell", async () => {
  // The tolerance is a COUNT of changes, never a duration. A canvas whose
  // hysteresis is a distance margin declares an allowance of zero, and it still
  // re-renders asynchronously between two reads, so settling has to absorb a
  // bounded number of changes at any allowance — including none.
  let reads = 0;
  const value = await settledValue(async () => {
    reads += 1;
    return reads <= 1 ? 1 : 2;
  }, 0);

  expect(value).toBe(2);
});

test("accepts a reader that changes the permitted number of times and then holds", async () => {
  // The count bounds CHANGES, so a reader that changes exactly the permitted
  // number of times and then holds perfectly still has settled — asynchronous
  // relayout produces precisely that shape. Settling therefore takes one
  // OBSERVATION after the last permitted transition, since the value that
  // follows the final change is the only one that can be confirmed stable.
  let reads = 0;
  const value = await settledValue(async () => {
    reads += 1;
    return reads <= 4 ? reads : 99;
  }, 0);

  expect(value).toBe(99);
});

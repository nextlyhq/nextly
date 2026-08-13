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
  // The defect this replaced: "settled" meant "two consecutive reads agreed".
  // During a permitted dwell every read agrees, and they all return the
  // PRE-move value — so the old reader returned 1 here and each caller compared
  // a stale target against where the pointer actually was.
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
  ).rejects.toThrow(/test reading was still changing/);
});

test("tolerates a reader that settles only after changing more than once", async () => {
  // A canvas is entitled to a dwell, and to another if the first expiry moves
  // the target somewhere that starts a second. A harness that accepted only one
  // transition would fail a compliant canvas, which is the error this suite has
  // made four times in other probes.
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

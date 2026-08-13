/**
 * The edge searches, run against a SIMULATED dwell-based canvas.
 *
 * Three of this harness's dwell fixes are invisible on the canvas it currently
 * drives: the PoC declares `dwellAllowanceMs: 0` because it genuinely has no
 * hysteresis, so every wait reduces to a no-op and the suite is green with or
 * without them. A fix nothing can fail is a fix nobody can check, and the whole
 * point of these searches is to admit an implementation that does not exist
 * yet.
 *
 * So the compliant canvas is simulated here instead. `dwellingCanvas` is a
 * resolver whose hysteresis is a TIMER — the requirement's other permitted
 * form — and each test states which broken version of the harness it fails on.
 *
 * No browser, matching `oscillation.test.ts` and `settle.test.ts`.
 */
import { expect, test } from "@playwright/test";

import { dragToZoneEdge, dragUntilTarget } from "./driver";

/** A zone's extent along the drag axis, in the same pixels `moveBy` speaks. */
interface Band {
  readonly from: number;
  readonly to: number;
}

/**
 * A canvas whose target commits only after the pointer has rested in a new
 * zone for `dwellMs`.
 *
 * This is a COMPLIANT implementation, not a broken one: the requirement permits
 * hysteresis expressed as a dwell instead of a distance margin. Everything
 * asserted below is about the harness reading it correctly.
 *
 * Gaps between bands are dead space, which resolves to -1 — the state the
 * forward search has to keep giving the dwell a chance from, rather than
 * treating as a departure that needs no wait.
 */
function dwellingCanvas(bands: readonly Band[], dwellMs: number) {
  let y = 0;
  let committed = -1;
  let pending = -1;
  let pendingSince = Date.now();

  const zoneAt = (at: number): number =>
    bands.findIndex(band => at >= band.from && at < band.to);

  const settleIfDue = (): number => {
    if (pending !== committed && Date.now() - pendingSince >= dwellMs) {
      committed = pending;
    }
    return committed;
  };

  return {
    dwellAllowanceMs: dwellMs,
    moveBy: (_dx: number, dy: number): Promise<void> => {
      y += dy;
      const zone = zoneAt(y);
      if (zone !== pending) {
        pending = zone;
        pendingSince = Date.now();
      }
      // A read is what advances the clock elsewhere; moving alone commits
      // nothing, which is what makes a fast traversal outrun the timer.
      settleIfDue();
      return Promise.resolve();
    },
    readActiveTarget: (): Promise<number> => Promise.resolve(settleIfDue()),
    at: (): number => y,
  };
}

test("acquires a first target on a resolver whose timer each move resets", async () => {
  // `dragUntilTarget` moves 8px a step. With a dwell longer than a step's round
  // trip, every move restarts the timer, so a version that sampled immediately
  // walked the whole budget without a target ever becoming active — and both
  // hysteresis suites then failed their precondition before reaching the
  // dwell-aware search they exist to run.
  const canvas = dwellingCanvas([{ from: 0, to: 400 }], 60);

  expect(await dragUntilTarget(canvas)).toBe(0);
});

test("finds an edge past dead space instead of racing through it", async () => {
  // The geometry is the point. The pointer starts in a wide zone, crosses a
  // gap, and reaches a NARROW one — narrow enough that a search giving it no
  // wait steps over it in a single move.
  //
  // This is what fails when departure is measured from the last ZONE rather
  // than the last value SEEN: once the pointer is in dead space every read
  // differs from that baseline at once, so the wait expires immediately for the
  // rest of the walk and the narrow zone is never observed. `crossed` comes
  // back false, and both hysteresis tests skip on a canvas that is compliant.
  const canvas = dwellingCanvas(
    [
      { from: 0, to: 40 },
      { from: 56, to: 72 },
    ],
    40
  );

  const edge = await dragToZoneEdge(canvas, 24);

  expect(edge.crossed, "the walk must observe the second zone").toBe(true);
  expect(edge.target).toBe(1);
});

test("brackets that edge rather than exhausting the reverse budget", async () => {
  // The reverse search steps one pixel at a time, so a compliant timer can be
  // carried through the entire budget in less time than one dwell. Reading
  // immediately then returns the crossed target every step, the edge is never
  // bracketed, and the jitter that follows is discarded as inconclusive —
  // silently, which is worse than failing.
  const canvas = dwellingCanvas(
    [
      { from: 0, to: 40 },
      { from: 56, to: 72 },
    ],
    40
  );

  const edge = await dragToZoneEdge(canvas, 24);

  expect(edge.bracketed, "the reverse search must locate the edge").toBe(true);
});

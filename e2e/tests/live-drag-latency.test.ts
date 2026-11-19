/**
 * Unit tests for how the live-drag speed check times a move to the canvas.
 *
 * Pure functions, no browser. They live under the Playwright runner because
 * it is the only test runner this package has, as `canvas/oscillation.test.ts`
 * does.
 */
import { expect, test } from "@playwright/test";

import {
  MOVE_BUDGET_MS,
  moveLatencies,
  p75,
  type TimedFrame,
  type TimedMove,
} from "./support/move-latency";

/** Twelve moves 150 ms apart, each asking for a size one larger. */
const MOVES: TimedMove[] = Array.from({ length: 12 }, (_, step) => ({
  at: 1000 + step * 150,
  value: 17 + step,
}));

/** The size before the drag, drawn before the first move. */
const BEFORE: TimedFrame = { at: 900, value: 16 };

/** Each move's value drawn `late` ms after its own move. */
function drawnAfter(late: number): TimedFrame[] {
  return [
    BEFORE,
    ...MOVES.map(move => ({ at: move.at + late, value: move.value })),
  ];
}

test("a renderer drawing every move 170 ms late reads as 170 ms, over the budget", () => {
  const latencies = moveLatencies(16, MOVES, drawnAfter(170));
  expect(latencies).toEqual(MOVES.map(() => 170));
  expect(p75(latencies)).toBe(170);
  expect(p75(latencies)).toBeGreaterThan(MOVE_BUDGET_MS);
});

test("a renderer keeping up reads as its own delay, within the budget", () => {
  const latencies = moveLatencies(16, MOVES, drawnAfter(16));
  expect(latencies).toEqual(MOVES.map(() => 16));
  expect(p75(latencies)).toBeLessThanOrEqual(MOVE_BUDGET_MS);
});

test("a move whose value is passed over is timed to the later value drawn", () => {
  const moves: TimedMove[] = [
    { at: 1000, value: 17 },
    { at: 1150, value: 18 },
    { at: 1300, value: 19 },
  ];
  // The second move's value never drawn: the third's supersedes it.
  const frames: TimedFrame[] = [
    BEFORE,
    { at: 1020, value: 17 },
    { at: 1330, value: 19 },
  ];
  expect(moveLatencies(16, moves, frames)).toEqual([20, 180, 30]);
});

test("a move asking for the value already asked for is not timed", () => {
  const moves: TimedMove[] = [
    { at: 1000, value: 16 },
    { at: 1150, value: 17 },
    { at: 1300, value: 17 },
  ];
  const frames: TimedFrame[] = [BEFORE, { at: 1200, value: 17 }];
  expect(moveLatencies(16, moves, frames)).toEqual([50]);
});

/**
 * How long a drag's moves take to reach the canvas, each move matched to the
 * frame that draws the value IT asked for.
 *
 * Timing a move to "the next frame that changed" is not that: a renderer
 * falling behind draws an earlier move's value just after a later move, and
 * that frame would be counted as the later move's. With moves 150 ms apart
 * and every value drawn 170 ms after its own move, each frame lands 20 ms
 * after the NEXT move, and a renderer late by 170 ms every time would read as
 * 20 ms. Matched by value, it reads as 170.
 *
 * @module tests/support/move-latency
 */

/** The budget for a pointer move to reach the canvas, at the 75th percentile. */
export const MOVE_BUDGET_MS = 100;

/** A pointer move, and the value it asked the canvas for. */
export interface TimedMove {
  /** When the move happened, on the clock the frames are timed on. */
  readonly at: number;
  readonly value: number;
}

/** A canvas frame that drew a new value. */
export interface TimedFrame {
  readonly at: number;
  readonly value: number;
}

/** Whether two drawn values are the same, past rounding in the drawing. */
function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

/**
 * Each move's time to the canvas: from the move to the first frame at or
 * after it drawing the value it asked for, or a value a later move asked for,
 * which supersedes it. A move asking for the value already asked for before
 * it (`initial` for the first) asks the canvas for nothing and has no time;
 * nor has a move none of whose values is ever drawn after it.
 */
export function moveLatencies(
  initial: number,
  moves: readonly TimedMove[],
  frames: readonly TimedFrame[]
): number[] {
  return moves.flatMap((move, index) => {
    const asked = moves[index - 1]?.value ?? initial;
    if (same(move.value, asked)) return [];
    const values = moves.slice(index).map(each => each.value);
    const shown = frames.find(
      frame =>
        frame.at >= move.at && values.some(value => same(value, frame.value))
    );
    return shown === undefined ? [] : [shown.at - move.at];
  });
}

/** The 75th percentile of `latencies`, or `Infinity` for none. */
export function p75(latencies: readonly number[]): number {
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.75) - 1] ?? Infinity;
}

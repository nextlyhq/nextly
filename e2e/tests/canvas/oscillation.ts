export interface Reversal {
  /** Index in the ORIGINAL sequence where the direction flipped. */
  index: number;
  from: number;
  to: number;
}

/**
 * Find the first point where the active drop target moves against the direction
 * it had been moving.
 *
 * Samples of -1 mean no zone was active and are skipped: they occur at the
 * start and end of every drag and over an invalid target, so counting them as
 * values would report reversals that never happened. Skipping them does not
 * hide a real one, because the comparison runs over the surviving samples in
 * their original order.
 *
 * A sequence with no established direction cannot reverse, so the direction is
 * fixed by the first pair of differing values and compared from there.
 */
export function findReversal(sequence: number[]): Reversal | null {
  const active = sequence
    .map((value, index) => ({ value, index }))
    .filter(sample => sample.value >= 0);

  let direction = 0;
  for (let i = 1; i < active.length; i++) {
    const previous = active[i - 1];
    const current = active[i];
    const step = current.value - previous.value;
    if (step === 0) continue;

    const stepDirection = step > 0 ? 1 : -1;
    if (direction === 0) {
      direction = stepDirection;
      continue;
    }
    if (stepDirection !== direction) {
      return { index: current.index, from: previous.value, to: current.value };
    }
  }
  return null;
}

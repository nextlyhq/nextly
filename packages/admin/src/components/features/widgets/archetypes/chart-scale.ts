/**
 * The arithmetic behind a chart of groups, with no React in it: each bar's
 * length as a share of the longest.
 *
 * Separate from the components so the part that can be WRONG can be tested
 * directly. jsdom does no layout, so a bar that overflows its track or divides
 * by zero renders exactly as one that does not. The numbers are where the
 * defects live, so they are asked questions here instead.
 *
 * It is total: a count of zero, a single group and all-zero counts are
 * ordinary inputs a real dashboard produces on its first day, not
 * edge cases to guard at the call site.
 *
 * @module components/features/widgets/archetypes/chart-scale
 */

/**
 * Each value as a fraction of the largest, in `0..1`.
 *
 * Scaled to the largest value rather than to a fixed ceiling, because a bar
 * chart's job is comparison between its own bars — a fixed ceiling would draw
 * every bar as a sliver whenever the counts happen to be small.
 *
 * A largest value of zero answers all zeros rather than dividing by it. That is
 * the honest picture: every bucket is empty, so no bar has any length, and the
 * reader sees an empty chart rather than a full one drawn from `0/0`.
 *
 * A negative count cannot come from a `count(*)`, and clamping rather than
 * rendering one keeps a bar inside its track if some other source ever produces
 * one.
 */
export function barFractions(counts: readonly number[]): number[] {
  const usable = counts.map(count =>
    Number.isFinite(count) && count > 0 ? count : 0
  );
  const largest = Math.max(0, ...usable);
  if (largest === 0) return usable.map(() => 0);
  return usable.map(count => count / largest);
}

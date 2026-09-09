/**
 * The arithmetic behind a chart, with no SVG and no React in it.
 *
 * Separate from the components so the parts that can be WRONG can be tested
 * directly. A path string rendered into jsdom tells you nothing — jsdom does no
 * layout, so a chart that overflows its box, inverts its axis or divides by
 * zero renders exactly as one that does not. The numbers are where the defects
 * live, so they are asked questions here instead.
 *
 * Every function is total: a count of zero, a single point and an all-zero
 * series are ordinary inputs a real dashboard produces on its first day, not
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

/** The box a line chart is drawn inside, in user units. */
export interface ChartBox {
  width: number;
  height: number;
  /** Kept clear on every side so a stroke is not clipped by the viewBox. */
  padding: number;
}

/**
 * The points of a line chart, in SVG user units.
 *
 * The x axis is the INDEX rather than the timestamp, because a timeseries
 * answers with one point per interval including the empty ones — the spacing is
 * already uniform, and reading the dates to re-derive that would introduce a
 * second opinion about a series the server already made regular.
 *
 * The y axis is inverted, as SVG's is: a larger count is a SMALLER y. Getting
 * this backwards produces a chart that is upside down and otherwise perfectly
 * plausible, which is why it is asserted rather than eyeballed.
 *
 * The baseline is always zero rather than the smallest value. A line starting
 * at the minimum exaggerates variation — counts of 100 and 102 become a cliff —
 * and for count data, where zero is meaningful and reachable, that is a
 * misreading the chart itself invites.
 */
export function linePoints(
  counts: readonly number[],
  box: ChartBox
): Array<{ x: number; y: number }> {
  const usable = counts.map(count =>
    Number.isFinite(count) && count > 0 ? count : 0
  );
  if (usable.length === 0) return [];

  const innerWidth = Math.max(0, box.width - box.padding * 2);
  const innerHeight = Math.max(0, box.height - box.padding * 2);
  const largest = Math.max(0, ...usable);
  const bottom = box.padding + innerHeight;

  // A single point has no span to divide, and one interval is a legitimate
  // window. It is placed at the LEFT edge rather than the centre so the marker
  // sits where the next point would extend from.
  const step = usable.length > 1 ? innerWidth / (usable.length - 1) : 0;

  return usable.map((count, index) => ({
    x: box.padding + step * index,
    // An all-zero series sits on the baseline rather than dividing by its own
    // maximum. Every interval was read and every one was empty, which is a
    // flat line at zero -- not an absent chart and not a full one.
    y: largest === 0 ? bottom : bottom - (count / largest) * innerHeight,
  }));
}

/** `M x,y L x,y …` for a set of points, or `""` when there is nothing to draw. */
export function linePath(points: ReadonlyArray<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const head = `M ${round(first.x)},${round(first.y)}`;
  if (rest.length === 0) return head;
  return `${head} ${rest.map(p => `L ${round(p.x)},${round(p.y)}`).join(" ")}`;
}

/**
 * The same line, closed down to the baseline so it can be filled.
 *
 * Drawn from the line's own points rather than recomputed, so the fill cannot
 * describe a different series than the stroke above it.
 *
 * A single point encloses no area, so it answers empty: a fill built from one
 * point would be a zero-width sliver that reads as a rendering fault.
 */
export function areaPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  baselineY: number
): string {
  if (points.length < 2) return "";
  const last = points[points.length - 1];
  const first = points[0];
  return [
    linePath(points),
    `L ${round(last.x)},${round(baselineY)}`,
    `L ${round(first.x)},${round(baselineY)}`,
    "Z",
  ].join(" ");
}

/**
 * Coordinates are rounded to two decimals before they reach the DOM.
 *
 * A float division produces values like `31.999999999999996`, and a path full
 * of them is both larger over the wire and impossible to compare in a test
 * without an epsilon. Two decimals is finer than a physical pixel at any
 * viewport this renders in.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

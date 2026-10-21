/**
 * What a chart says: its accessible name, the current point its live region
 * reads, its text alternative, and whether its latest point is circled and
 * labelled.
 *
 * Numbers arrive formatted, by the formatter the "View as table" table uses,
 * so the words and the table agree. These functions decide only which figures
 * are said and how they are joined. A chart of groups says "most", never
 * "largest"; where its counts are floors it says neither, since a bounded
 * count cannot rank the groups it never reached.
 *
 * @module components/features/widgets/charts/chart-text
 */

export type ChartTier = "small" | "medium" | "large";

/** The chart's accessible name: what it shows, its range, and how to read it. */
export function chartName(
  chart:
    | { kind: "points"; what: string; range: string }
    | { kind: "bars"; what: string }
): string {
  return chart.kind === "points"
    ? `${chart.what}, ${chart.range}. Use the arrow keys to read each point.`
    : `${chart.what}. Use the arrow keys to read each bar.`;
}

/**
 * The current point, as the live region reads it: the series where there are
 * several, then when (or which group) and how many, then where it sits ("2 of
 * 3"). The position makes every move heard: two bars, or two intervals, can
 * read alike, and a live region whose text does not change says nothing.
 */
export function currentPointText(point: {
  series?: string;
  when: string;
  value: string;
  position: { index: number; of: number };
}): string {
  const where =
    point.series === undefined ? point.when : `${point.series}, ${point.when}`;
  return `${where}: ${point.value}. ${point.position.index + 1} of ${point.position.of}.`;
}

interface Point {
  when: string;
  value: number;
}

/**
 * The total of a range, its latest point, and its highest. Of tied highest
 * points, the most recent, the one a reader is likelier to ask about.
 */
export function overTimeFigures(points: readonly Point[]): {
  total: number;
  latest?: Point;
  highest?: Point;
} {
  if (points.length === 0) return { total: 0 };
  let highest = points[0];
  let total = 0;
  for (const point of points) {
    total += point.value;
    if (point.value >= highest.value) highest = point;
  }
  return { total, latest: points[points.length - 1], highest };
}

/** An over-time chart's text alternative: its range, total, latest and highest. */
export function overTimeSummary(chart: {
  what: string;
  range: string;
  points: readonly Point[];
  format: (n: number) => string;
}): string {
  const { total, latest, highest } = overTimeFigures(chart.points);
  const head = `${chart.what}, ${chart.range}`;
  if (latest === undefined || highest === undefined) return `${head}: none.`;
  return (
    `${head}: ${chart.format(total)} in total. ` +
    `Latest ${chart.format(latest.value)} on ${latest.when}; ` +
    `highest ${chart.format(highest.value)} on ${highest.when}.`
  );
}

/**
 * A chart of groups' text alternative, from groups already in drawing order:
 * how many groups, the total, and the first group as "Most". With floors, it
 * says the counts are lower bounds instead, and names no group first. Where
 * the answer itself left groups out (`partial`), the sum is of the groups
 * counted, not a total, and it says more exist.
 */
export function groupsSummary(chart: {
  what: string;
  groups: readonly { label: string; count: number }[];
  floors: boolean;
  partial?: boolean;
  format: (n: number) => string;
}): string {
  const n = chart.groups.length;
  if (n === 0) return `${chart.what}: no groups.`;
  const total = chart.groups.reduce((sum, group) => sum + group.count, 0);
  const groups = n === 1 ? "1 group" : `${n} groups`;
  if (chart.floors) {
    return (
      `${chart.what}: ${groups} counted, at least ${chart.format(total)} in all. ` +
      "Counts are lower bounds, and groups not counted may exist."
    );
  }
  const first = chart.groups[0];
  const most = `Most: ${first.label}, ${chart.format(first.count)}.`;
  if (chart.partial) {
    return (
      `${chart.what}: ${groups} counted, ${chart.format(total)} among them. ` +
      `${most} More groups exist.`
    );
  }
  return `${chart.what}: ${groups}, ${chart.format(total)} in total. ${most}`;
}

/**
 * Whether a chart over time circles its latest point, and labels it. Circled
 * at every tier, a single point included; labelled except at the small tier,
 * where the figure above the chart already states the latest value.
 */
export function latestMarker(
  tier: ChartTier,
  points: number
): { circle: boolean; label: boolean } {
  if (points === 0) return { circle: false, label: false };
  return { circle: true, label: tier !== "small" };
}

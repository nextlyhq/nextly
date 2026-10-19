/**
 * A chart over time: one line per series, its value axis, and its latest point marked.
 *
 * A standalone component with a plain props API -- series of points in, no widget definition
 * or query result -- so the over-time archetype and a plugin's own card draw time the same
 * way. The card's tier and formatter are read where it is drawn, from the card around it.
 *
 * The line is SVG stretched to the card (`preserveAspectRatio="none"`), with
 * `vector-effect="non-scaling-stroke"` so its weight does not change with the card's width.
 * Everything that must keep its size -- the axis labels, the latest point's mark and label, the
 * legend -- is HTML laid over or beside it, never inside the stretched viewBox, where a circle
 * would be drawn as an ellipse and a label scaled with the card.
 *
 * @module components/features/widgets/charts/over-time-chart
 */

import { ChartFrame, type ChartRow } from "../archetypes/chart-frame";
import {
  linePath,
  linePoints,
  areaPath,
  type ChartBox,
} from "../archetypes/chart-scale";
import { cardNumber } from "../frame/format";
import { useCardTier } from "../frame/tier";

import { chartColour, type ChartSlot } from "./chart-colour";
import { latestMarker, overTimeSummary } from "./chart-text";

/** One point of a series: when, written as the table writes it, and how many. */
export interface OverTimePoint {
  /** Unique within its series: the instant, not the label, since two can format alike. */
  key: string;
  label: string;
  value: number;
}

export interface OverTimeSeries {
  key: string;
  /** What the series is, named in the legend where there are several. */
  name: string;
  /** Oldest first. */
  points: readonly OverTimePoint[];
}

export interface OverTimeChartProps {
  /** What the chart shows, named to assistive tech and above the table. */
  title: string;
  series: readonly OverTimeSeries[];
  /** Heads the table's first column. */
  labelHeading?: string;
}

/**
 * The user units the lines are drawn in. Arbitrary: the SVG scales to the card, so these set the
 * shape's proportions rather than its size. The padding keeps a 2px stroke off the edges.
 */
const BOX: ChartBox = { width: 240, height: 64, padding: 3 };

/** How many dates a large card writes under its lines, ends included. */
const LARGE_TIER_DATES = 5;

/** The chart colour of the series at `index`: the first colour for one series, then in turn. */
function seriesSlot(index: number): ChartSlot {
  return ((index % 5) + 1) as ChartSlot;
}

export function OverTimeChart({
  title,
  series,
  labelHeading = "Interval",
}: OverTimeChartProps) {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const first = series[0];
  const labels = first ? first.points.map(point => point.label) : [];
  // One scale for every series, so their lines are comparable: zero to the highest value.
  const highest = Math.max(
    0,
    ...series.flatMap(line => line.points.map(point => point.value))
  );
  const description = series
    .map(line =>
      overTimeSummary({
        what: series.length > 1 ? `${title}, ${line.name}` : title,
        range: rangeOf(line.points),
        points: line.points.map(point => ({
          when: point.label,
          value: point.value,
        })),
        format: value => cardNumber(value).label,
      })
    )
    .join(" ");

  return (
    <ChartFrame
      title={title}
      description={description}
      labelHeading={labelHeading}
      rows={tableRows(series)}
    >
      {({ titleId, descId, title: heading, description: text }) => (
        <div className="flex flex-col gap-1">
          {series.length > 1 ? <SeriesLegend series={series} /> : null}
          {series.length === 1 && first ? (
            <OverTimeSummary points={first.points} />
          ) : null}
          <div className="flex gap-1.5">
            {tier === "small" ? null : <ValueAxis highest={highest} />}
            <div className="relative min-w-0 flex-1">
              <svg
                role="img"
                aria-labelledby={titleId}
                aria-describedby={descId}
                viewBox={`0 0 ${BOX.width} ${BOX.height}`}
                preserveAspectRatio="none"
                className="block h-16 w-full"
              >
                <title id={titleId}>{heading}</title>
                <desc id={descId}>{text}</desc>
                {tier === "small" ? null : <Gridlines />}
                {series.map((line, index) => (
                  <SeriesLine
                    key={line.key}
                    points={line.points}
                    highest={highest}
                    slot={seriesSlot(index)}
                    filled={series.length === 1}
                  />
                ))}
              </svg>
              {series.map((line, index) => (
                <LatestPoint
                  key={line.key}
                  points={line.points}
                  highest={highest}
                  slot={seriesSlot(index)}
                />
              ))}
            </div>
          </div>
          <OverTimeDates labels={labels} />
        </div>
      )}
    </ChartFrame>
  );
}

/** "first to last", or the one point's label, or nothing. */
function rangeOf(points: readonly OverTimePoint[]): string {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return "no range";
  return start === end ? start.label : `${start.label} to ${end.label}`;
}

/** The table's rows: one per point, named by its series where there are several. */
function tableRows(series: readonly OverTimeSeries[]): ChartRow[] {
  return series.flatMap(line =>
    line.points.map(point => ({
      key: `${line.key}:${point.key}`,
      label: series.length > 1 ? `${line.name}, ${point.label}` : point.label,
      count: point.value,
    }))
  );
}

/** The points of one series in the chart's box, on the chart's shared scale. */
function scaled(points: readonly OverTimePoint[], highest: number) {
  return linePoints(
    points.map(point => point.value),
    BOX,
    highest
  );
}

/** One series' line, in its chart colour, and the soft fill under it for a single series. */
function SeriesLine({
  points,
  highest,
  slot,
  filled,
}: {
  points: readonly OverTimePoint[];
  highest: number;
  slot: ChartSlot;
  filled: boolean;
}) {
  const plotted = scaled(points, highest);
  const line = linePath(plotted);
  const area = filled ? areaPath(plotted, BOX.height - BOX.padding) : null;
  const colour = chartColour(slot);
  return (
    <g data-testid="chart-series" style={{ color: colour }}>
      {area ? (
        <path d={area} fill="currentColor" className="opacity-10" />
      ) : null}
      {line ? (
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

/** The zero and highest gridlines, in the border token, at medium and large. */
function Gridlines() {
  const top = BOX.padding;
  const bottom = BOX.height - BOX.padding;
  return (
    <g data-testid="chart-gridlines" className="text-border">
      {[top, bottom].map(y => (
        <line
          key={y}
          x1={0}
          x2={BOX.width}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/**
 * The value axis: the highest value at the top gridline and zero at the bottom, in text tokens.
 * HTML beside the chart, so its size is the same on every card. Hidden from assistive tech: the
 * description states the figures, and these would be read as bare numbers.
 */
function ValueAxis({ highest }: { highest: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="chart-value-axis"
      className="flex h-16 flex-col justify-between text-right text-[10px] leading-none tabular-nums text-muted-foreground"
    >
      <span>{cardNumber(highest).label}</span>
      <span>{cardNumber(0).label}</span>
    </div>
  );
}

/**
 * A series' latest point: circled at every tier, a single point included, and its value
 * labelled except at the small tier, where the figures above the chart already state it.
 */
function LatestPoint({
  points,
  highest,
  slot,
}: {
  points: readonly OverTimePoint[];
  highest: number;
  slot: ChartSlot;
}) {
  const tier = useCardTier() ?? "medium";
  const marker = latestMarker(tier, points.length);
  const plotted = scaled(points, highest);
  const at = plotted[plotted.length - 1];
  const point = points[points.length - 1];
  if (!marker.circle || !at || !point) return null;
  // As fractions of the box, so the HTML mark sits on the stretched line at any width.
  const left = `${(at.x / BOX.width) * 100}%`;
  const top = `${(at.y / BOX.height) * 100}%`;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="chart-latest-point"
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
        // design-lint-ok: the position is the datum, and the colour is the series' chart slot.
        style={{ left, top, backgroundColor: chartColour(slot) }}
      />
      {marker.label ? (
        <span
          aria-hidden="true"
          data-testid="chart-latest-label"
          className="absolute -translate-y-full pb-1 text-[10px] font-medium leading-none tabular-nums text-foreground"
          // design-lint-ok: placed by the latest point's own position.
          style={{ right: 0, top }}
        >
          {cardNumber(point.value).label}
        </span>
      ) : null}
    </>
  );
}

/** Each series named beside its colour, above the chart at every tier, where there are several. */
function SeriesLegend({ series }: { series: readonly OverTimeSeries[] }) {
  return (
    <ul
      data-testid="chart-legend"
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      {series.map((line, index) => (
        <li key={line.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            // design-lint-ok: the swatch IS the series' chart colour.
            style={{ backgroundColor: chartColour(seriesSlot(index)) }}
          />
          {line.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * A small card's figures: the latest value and the range's total, the two numbers that still
 * fit when the chart has no room for an axis or dates. Wider cards label the latest point.
 */
function OverTimeSummary({ points }: { points: readonly OverTimePoint[] }) {
  const latest = points[points.length - 1];
  if (useCardTier() !== "small" || !latest) return null;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return (
    <p
      data-testid="timeseries-summary"
      className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"
    >
      <span>
        <span className="font-medium text-foreground">
          {cardNumber(latest.value).label}
        </span>{" "}
        latest
      </span>
      <span>
        <span className="font-medium text-foreground">
          {cardNumber(total).label}
        </span>{" "}
        in total
      </span>
    </p>
  );
}

/**
 * The dates under the lines at the card's tier: none when small, the two ends when medium, and
 * evenly spaced dates between them when large. Hidden from assistive tech: the description
 * names the range, and these would be read as bare dates.
 */
function OverTimeDates({ labels }: { labels: readonly string[] }) {
  const tier = useCardTier() ?? "medium";
  if (tier === "small") return null;
  const shown = datesShown(labels, tier === "large" ? LARGE_TIER_DATES : 2);
  return (
    <div
      aria-hidden="true"
      data-testid="timeseries-dates"
      className="flex justify-between gap-2 text-[10px] leading-none text-muted-foreground"
    >
      {shown.map(index => (
        <span key={index}>{labels[index]}</span>
      ))}
    </div>
  );
}

/** The indexes of `count` dates spread evenly from the first label to the last. */
function datesShown(labels: readonly string[], count: number): number[] {
  if (labels.length <= 1) return labels.length === 1 ? [0] : [];
  const steps = Math.min(count, labels.length) - 1;
  const indexes = Array.from({ length: steps + 1 }, (_, step) =>
    Math.round((step * (labels.length - 1)) / steps)
  );
  return [...new Set(indexes)];
}

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

import type { JSX } from "react";

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
import { ChartReachArea, ChartTooltip, useChartReach } from "./chart-reach";
import {
  chartName,
  currentPointText,
  latestMarker,
  overTimeSummary,
} from "./chart-text";

/** One interval of the chart's range: its key, and how it is written, as the table writes it. */
export interface OverTimeInterval {
  /** Unique within the range: the instant, not the label, since two can format alike. */
  key: string;
  label: string;
}

/** One point of a series: the interval it is in, by key, and how many. */
export interface OverTimePoint {
  key: string;
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
  /**
   * The intervals every series is drawn against, oldest first. Given by the caller, who knows
   * their order: a point's key alone cannot say when it falls, so a series that shares no
   * interval with another could not be placed beside it. A point whose key is not here is not
   * drawn.
   */
  intervals: readonly OverTimeInterval[];
  series: readonly OverTimeSeries[];
  /** Heads the table's first column. */
  labelHeading?: string;
  /**
   * How a single series is drawn: a line, or one bar per interval. Several series are always
   * lines, since bars side by side in one interval would no longer read as a sequence.
   */
  chartStyle?: "line" | "bars";
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
  intervals,
  series: given,
  labelHeading = "Interval",
  chartStyle = "line",
}: OverTimeChartProps): JSX.Element {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  // One range for every series, so a point is drawn at its interval whatever else its series
  // holds, and one scale, so their lines are comparable: zero to the highest value.
  const domain = domainOf(intervals);
  const series = given.map(line => ({
    ...line,
    points: line.points.filter(point => domain.index.has(point.key)),
  }));
  const first = series[0];
  const highest = Math.max(
    0,
    ...series.flatMap(line => line.points.map(point => point.value))
  );
  // One series drawn as bars stands each bar in its interval's own band, so the first and last
  // bars are as wide as the rest; lines run edge to edge.
  const banded = chartStyle === "bars" && series.length === 1;
  const plots = series.map(line =>
    placed(line.points, domain, highest, banded)
  );
  const description = series
    .map(line =>
      overTimeSummary({
        what: series.length > 1 ? `${title}, ${line.name}` : title,
        range: rangeOf(line.points, domain),
        points: line.points.map(point => ({
          when: domain.labelOf(point.key),
          value: point.value,
        })),
        format: value => cardNumber(value).label,
      })
    )
    .join(" ");
  // The keys move through the range interval by interval, and between series where there are
  // several; an interval a series has no point in is read as such rather than skipped.
  const reach = useChartReach({
    kind: "points",
    series: series.length,
    points: domain.labels.length,
  });
  const keyedLine = reach.keyed ? series[reach.keyed.series] : undefined;
  const announcement =
    reach.keyed && keyedLine
      ? currentPointText({
          series: series.length > 1 ? keyedLine.name : undefined,
          when: domain.labels[reach.keyed.index] ?? "",
          value: valueAt(keyedLine, intervals[reach.keyed.index]?.key),
          position: { index: reach.keyed.index, of: domain.labels.length },
        })
      : "";
  const shownAt = reach.shown ? intervals[reach.shown.index] : undefined;

  return (
    <ChartFrame
      title={title}
      description={description}
      labelHeading={labelHeading}
      rows={tableRows(series, domain)}
    >
      {({ descId, title: heading, description: text }) => (
        <ChartReachArea
          reach={reach}
          name={chartName({
            kind: "points",
            what: heading,
            range: rangeOfIntervals(domain),
          })}
          describedBy={descId}
          announcement={announcement}
        >
          <div className="flex flex-col gap-1">
            {series.length > 1 ? <SeriesLegend series={series} /> : null}
            {series.length === 1 && first ? (
              <OverTimeSummary points={first.points} />
            ) : null}
            <div className="flex gap-1.5">
              {tier === "small" ? null : <ValueAxis highest={highest} />}
              <div className="relative min-w-0 flex-1">
                {/* Drawn for sight and hidden from assistive tech: the area around it is the
                    chart's one accessible object, named and described once. No `<title>`, which a
                    browser would also show as a hover tooltip over the chart's own. */}
                <svg
                  aria-hidden="true"
                  viewBox={`0 0 ${BOX.width} ${BOX.height}`}
                  preserveAspectRatio="none"
                  className="block h-16 w-full"
                >
                  <desc id={descId}>{text}</desc>
                  {tier === "small" ? null : <Gridlines />}
                  <SeriesMarks
                    series={series}
                    plots={plots}
                    size={domain.labels.length}
                    bars={banded}
                  />
                </svg>
                {series.map((line, index) => (
                  <LatestPoint
                    key={line.key}
                    points={line.points}
                    plotted={plots[index] ?? []}
                    slot={seriesSlot(index)}
                    // One series labels its latest value beside it; several name theirs in the
                    // legend, where values close together cannot print over each other.
                    labelled={series.length === 1}
                  />
                ))}
                <IntervalStrips
                  count={domain.labels.length}
                  banded={banded}
                  onHover={index => reach.hover({ series: 0, index })}
                />
                {reach.shown && shownAt ? (
                  <IntervalInView
                    index={reach.shown.index}
                    size={domain.labels.length}
                    banded={banded}
                    title={shownAt.label}
                    marks={series.map((line, index) => ({
                      key: line.key,
                      name: series.length > 1 ? line.name : undefined,
                      slot: seriesSlot(index),
                      value: valueAt(line, shownAt.key),
                      y: plots[index]?.[
                        line.points.findIndex(
                          point => point.key === shownAt.key
                        )
                      ]?.y,
                    }))}
                  />
                ) : null}
              </div>
            </div>
            <OverTimeDates labels={domain.labels} />
          </div>
        </ChartReachArea>
      )}
    </ChartFrame>
  );
}

/** "first to last", or the one point's interval, or nothing. */
function rangeOf(points: readonly OverTimePoint[], domain: Domain): string {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return "no range";
  const from = domain.labelOf(start.key);
  return start === end ? from : `${from} to ${domain.labelOf(end.key)}`;
}

/** The whole range the chart is drawn against, first interval to last, for its name. */
function rangeOfIntervals(domain: Domain): string {
  const from = domain.labels[0];
  const to = domain.labels[domain.labels.length - 1];
  if (from === undefined || to === undefined) return "no range";
  return from === to ? from : `${from} to ${to}`;
}

/** A series' value in the interval `key`, as the table writes it, or that it has none there. */
function valueAt(line: OverTimeSeries, key: string | undefined): string {
  const point = line.points.find(candidate => candidate.key === key);
  return point ? cardNumber(point.value).label : "no value";
}

/**
 * Where the interval at `index` of `size` is drawn across the box, in its user units. The ONE
 * horizontal scale: the marks are plotted by it and the pointer's targets, the rule and the
 * tooltip are placed by it, so they cannot drift onto different intervals. A line's points run
 * from edge to edge; `banded`, each interval is drawn in the middle of its own equal band, which
 * leaves a bar at either end room for its whole width.
 */
function xAt(index: number, size: number, banded: boolean): number {
  const span = BOX.width - BOX.padding * 2;
  if (banded) return BOX.padding + (span * (index + 0.5)) / Math.max(1, size);
  const step = size > 1 ? span / (size - 1) : 0;
  return BOX.padding + step * index;
}

/** How far across the box the interval at `index` of `size` is drawn, as a percentage. */
function acrossOf(index: number, size: number, banded: boolean): number {
  return (xAt(index, size, banded) / BOX.width) * 100;
}

/**
 * The pointer's targets: one strip per interval, the full height of the lines, reaching halfway
 * to its neighbours, so every interval is under the pointer somewhere and none overlap. Hidden
 * from assistive tech and never focused: the keys reach the same intervals.
 */
function IntervalStrips({
  count,
  banded,
  onHover,
}: {
  count: number;
  banded: boolean;
  onHover: (index: number) => void;
}) {
  const across = Array.from({ length: count }, (_, index) =>
    acrossOf(index, count, banded)
  );
  return (
    <>
      {across.map((at, index) => {
        const before = index === 0 ? 0 : (at + (across[index - 1] ?? at)) / 2;
        const after =
          index === count - 1 ? 100 : (at + (across[index + 1] ?? at)) / 2;
        return (
          <span
            // Intervals have no other id here, and a strip's place is its identity.
            key={index}
            aria-hidden="true"
            data-testid="chart-interval"
            className="absolute inset-y-0"
            // design-lint-ok: placed by its interval's position on the stretched line.
            style={{ left: `${before}%`, width: `${after - before}%` }}
            onPointerEnter={() => onHover(index)}
          />
        );
      })}
    </>
  );
}

/**
 * The interval in view: a rule down through it, each series' point there circled in its
 * colour, and the tooltip naming every series' value, on the interval's own side of the chart.
 */
function IntervalInView({
  index,
  size,
  banded,
  title,
  marks,
}: {
  index: number;
  size: number;
  banded: boolean;
  title: string;
  marks: ReadonlyArray<{
    key: string;
    name?: string;
    slot: ChartSlot;
    value: string;
    y: number | undefined;
  }>;
}) {
  const across = acrossOf(index, size, banded);
  const left = `${across}%`;
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-border"
        // design-lint-ok: placed by the interval's position on the stretched line.
        style={{ left }}
      />
      {marks.map(mark =>
        mark.y === undefined ? null : (
          <span
            key={mark.key}
            aria-hidden="true"
            data-testid="chart-point-in-view"
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            // design-lint-ok: the position is the datum, and the colour is the series' chart slot.
            style={{
              left,
              top: `${(mark.y / BOX.height) * 100}%`,
              backgroundColor: chartColour(mark.slot),
            }}
          />
        )
      )}
      <ChartTooltip
        title={title}
        lines={marks.map(mark => ({
          key: mark.key,
          slot: mark.slot,
          name: mark.name,
          value: mark.value,
        }))}
        // Below the lines, on the interval's own side, and no wider than the room on that side,
        // so a long series name wraps rather than running off the card's edge.
        style={
          across <= 50
            ? { top: "100%", left, maxWidth: `${100 - across}%` }
            : { top: "100%", right: `${100 - across}%`, maxWidth: `${across}%` }
        }
      />
    </>
  );
}

/** The table's rows: one per point, named by its series where there are several. */
function tableRows(
  series: readonly OverTimeSeries[],
  domain: Domain
): ChartRow[] {
  return series.flatMap(line =>
    line.points.map(point => {
      const when = domain.labelOf(point.key);
      return {
        // A tuple, encoded so no series key and point key can join into another pair's.
        key: JSON.stringify([line.key, point.key]),
        label: series.length > 1 ? `${line.name}, ${when}` : when,
        count: point.value,
      };
    })
  );
}

/** The intervals every series is drawn against: each key's position, and how it is written. */
interface Domain {
  index: ReadonlyMap<string, number>;
  labels: string[];
  labelOf: (key: string) => string;
}

/** The caller's range, as positions and labels by key. */
function domainOf(intervals: readonly OverTimeInterval[]): Domain {
  const index = new Map(
    intervals.map((interval, position) => [interval.key, position])
  );
  const names = new Map(
    intervals.map(interval => [interval.key, interval.label])
  );
  return {
    index,
    labels: intervals.map(interval => interval.label),
    labelOf: key => names.get(key) ?? key,
  };
}

/** A series' points in the chart's box: x by its interval in the shared range, y on one scale. */
function placed(
  points: readonly OverTimePoint[],
  domain: Domain,
  highest: number,
  banded: boolean
): Array<{ x: number; y: number }> {
  const heights = linePoints(
    points.map(point => point.value),
    BOX,
    highest
  );
  const size = domain.labels.length;
  return points.map((point, position) => ({
    x: xAt(domain.index.get(point.key) ?? position, size, banded),
    y: heights[position]?.y ?? BOX.height - BOX.padding,
  }));
}

/** One series' line, in its chart colour, and the soft fill under it for a single series. */
function SeriesLine({
  plotted,
  slot,
  filled,
}: {
  plotted: ReadonlyArray<{ x: number; y: number }>;
  slot: ChartSlot;
  filled: boolean;
}) {
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

/** Every series' marks: bars for a single series drawn as bars, lines otherwise. */
function SeriesMarks({
  series,
  plots,
  size,
  bars,
}: {
  series: readonly OverTimeSeries[];
  plots: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  size: number;
  bars: boolean;
}) {
  if (bars) {
    return (
      <SeriesBars plotted={plots[0] ?? []} slot={seriesSlot(0)} size={size} />
    );
  }
  return (
    <>
      {series.map((line, index) => (
        <SeriesLine
          key={line.key}
          plotted={plots[index] ?? []}
          slot={seriesSlot(index)}
          filled={series.length === 1}
        />
      ))}
    </>
  );
}

/**
 * One series as bars, in its chart colour: one per interval, standing on the zero line in the
 * middle of its interval's band (`xAt`, banded), where the latest point, the pointer's strip and
 * the rule are placed too.
 */
function SeriesBars({
  plotted,
  slot,
  size,
}: {
  plotted: ReadonlyArray<{ x: number; y: number }>;
  slot: ChartSlot;
  size: number;
}) {
  const base = BOX.height - BOX.padding;
  const span = BOX.width - BOX.padding * 2;
  // Six tenths of an interval's band, so neighbouring bars keep a gap between them.
  const width = Math.max(1, (span / Math.max(1, size)) * 0.6);
  return (
    <g
      data-testid="chart-series"
      data-chart-style="bars"
      style={{ color: chartColour(slot) }}
    >
      {plotted.map(point => (
        <rect
          key={point.x}
          x={point.x - width / 2}
          y={point.y}
          width={width}
          height={Math.max(0, base - point.y)}
          fill="currentColor"
        />
      ))}
    </g>
  );
}

/**
 * The zero and highest gridlines, at medium and large: drawn in the border token itself rather
 * than through a text colour class, since a line is not text and is not held to a text minimum.
 */
function Gridlines() {
  const top = BOX.padding;
  const bottom = BOX.height - BOX.padding;
  return (
    <g data-testid="chart-gridlines">
      {[top, bottom].map(y => (
        <line
          key={y}
          x1={0}
          x2={BOX.width}
          y1={y}
          y2={y}
          stroke="var(--nx-border)"
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
  plotted,
  slot,
  labelled,
}: {
  points: readonly OverTimePoint[];
  plotted: ReadonlyArray<{ x: number; y: number }>;
  slot: ChartSlot;
  /** Whether its value is written beside it; a chart of several series names them in its legend. */
  labelled: boolean;
}) {
  const tier = useCardTier() ?? "medium";
  const marker = latestMarker(tier, points.length);
  const at = plotted[plotted.length - 1];
  const point = points[points.length - 1];
  if (!marker.circle || !at || !point) return null;
  // As fractions of the box, so the HTML mark sits on the stretched line at any width.
  const across = (at.x / BOX.width) * 100;
  const left = `${across}%`;
  const top = `${(at.y / BOX.height) * 100}%`;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="chart-latest-point"
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        // design-lint-ok: the position is the datum, and the colour is the series' chart slot.
        style={{ left, top, backgroundColor: chartColour(slot) }}
      />
      {labelled && marker.label ? (
        <span
          aria-hidden="true"
          data-testid="chart-latest-label"
          className="absolute -translate-y-full pb-1 text-[10px] font-medium leading-none tabular-nums text-foreground"
          // design-lint-ok: placed by the latest point's own position, on its own side of the
          // chart, so a single point at the left edge is labelled there rather than across it.
          style={
            across <= 50 ? { left, top } : { right: `${100 - across}%`, top }
          }
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
          <LatestValue points={line.points} />
        </li>
      ))}
    </ul>
  );
}

/** A series' latest value in its legend entry, where several series cannot label their lines. */
function LatestValue({ points }: { points: readonly OverTimePoint[] }) {
  const latest = points[points.length - 1];
  if (!latest) return null;
  return (
    <span className="font-medium tabular-nums text-foreground">
      {cardNumber(latest.value).label}
    </span>
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

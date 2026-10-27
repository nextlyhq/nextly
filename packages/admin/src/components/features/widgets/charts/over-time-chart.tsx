/**
 * A chart over time: one line per series, its value axis, and its latest point marked.
 *
 * A standalone component with a plain props API -- series of points in, no widget definition
 * or query result -- so the over-time archetype and a plugin's own card draw time the same
 * way. The card's tier and formatter are read where it is drawn, from the card around it.
 *
 * The marks are drawn by the chart engine, in `drawn/over-time-drawing`, which this module loads
 * lazily: the engine reaches a page only where a chart is drawn, and until it arrives the chart
 * holds its height. Everything a reader needs is here and drawn without the engine -- the chart's
 * name, description and table, the keys and the live region, the legend and a small card's
 * figures -- so the chart can be read before its marks arrive.
 *
 * @module components/features/widgets/charts/over-time-chart
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { lazy, Suspense, type JSX } from "react";

import { ChartFrame, type ChartRow } from "../archetypes/chart-frame";
import { cardNumber } from "../frame/format";
import { useCardTier } from "../frame/tier";

import { chartColour, type ChartSlot } from "./chart-colour";
import {
  CHART_DATES_HEIGHT,
  CHART_PLOT_HEIGHT,
  seriesKey,
  type ChartConfig,
} from "./chart-config";
import { ChartReachArea, ChartTooltip, useChartReach } from "./chart-reach";
import {
  chartName,
  currentPointText,
  latestMarker,
  overTimeSummary,
} from "./chart-text";
import type { OverTimeLatest } from "./drawn/over-time-drawing";

const OverTimeDrawing = lazy(() => import("./drawn/over-time-drawing"));

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

/** How many dates a large card writes under its lines, ends included. */
const LARGE_TIER_DATES = 3;

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
  // holds, and one scale, so their lines are comparable.
  const domain = domainOf(intervals);
  const series = given.map(line => ({
    ...line,
    points: line.points.filter(point => domain.index.has(point.key)),
  }));
  const first = series[0];
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
  const axes = tier !== "small";
  const height = axes
    ? CHART_PLOT_HEIGHT + CHART_DATES_HEIGHT
    : CHART_PLOT_HEIGHT;

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
            {/* The description stays here for the area to point at, hidden with the drawing:
                the area around it is the chart's one accessible object, described once. */}
            <span aria-hidden="true">
              <span id={descId} className="sr-only">
                {text}
              </span>
            </span>
            <Suspense
              fallback={
                <div
                  aria-hidden="true"
                  data-testid="chart-pending"
                  // design-lint-ok: holds the drawing's own height while the engine loads.
                  style={{ height }}
                />
              }
            >
              <OverTimeDrawing
                rows={drawnRows(intervals, series)}
                config={configOf(series)}
                style={drawnStyle(chartStyle, series.length)}
                axes={axes}
                dates={datesShown(
                  domain.labels,
                  tier === "large" ? LARGE_TIER_DATES : 2
                )}
                latest={series.map(line =>
                  latestOf(line, domain, tier, series.length === 1)
                )}
                shown={reach.shown?.index}
                onHover={index => reach.hover({ series: 0, index })}
                tooltip={
                  shownAt ? (
                    <ChartTooltip
                      title={shownAt.label}
                      lines={series.map((line, index) => ({
                        key: line.key,
                        name: series.length > 1 ? line.name : undefined,
                        slot: seriesSlot(index),
                        value: valueAt(line, shownAt.key),
                      }))}
                      className="static"
                    />
                  ) : null
                }
                height={height}
              />
            </Suspense>
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

/** How the marks are drawn: a single series as bars or as an area, several as lines. */
function drawnStyle(
  chartStyle: "line" | "bars",
  seriesCount: number
): "area" | "lines" | "bars" {
  if (seriesCount !== 1) return "lines";
  return chartStyle === "bars" ? "bars" : "area";
}

/** The series as the drawing keys them: `s0`, `s1`, … each named and coloured by its place. */
function configOf(series: readonly OverTimeSeries[]): ChartConfig {
  return Object.fromEntries(
    series.map((line, index) => [
      seriesKey(index),
      { label: line.name, slot: seriesSlot(index) },
    ])
  );
}

/** One row per interval, oldest first, with each series' value there or `null` for none. */
function drawnRows(
  intervals: readonly OverTimeInterval[],
  series: readonly OverTimeSeries[]
) {
  const values = series.map(
    line => new Map(line.points.map(point => [point.key, point.value]))
  );
  return intervals.map(interval => ({
    key: interval.key,
    label: interval.label,
    values: values.map(byKey => byKey.get(interval.key) ?? null),
  }));
}

/**
 * A series' latest point as the card's tier marks it: circled at every tier, a single point
 * included, and its value written beside it except at the small tier, where the figures above the
 * chart already state it, and on a chart of several series, which names them in its legend.
 */
function latestOf(
  line: OverTimeSeries,
  domain: Domain,
  tier: SizeTier,
  labelled: boolean
): OverTimeLatest | undefined {
  const marker = latestMarker(tier, line.points.length);
  const point = line.points[line.points.length - 1];
  const index = point ? domain.index.get(point.key) : undefined;
  if (!marker.circle || !point || index === undefined) return undefined;
  return {
    index,
    value: point.value,
    // As drawn, "1.2k": the table and the live region say it in full.
    label:
      labelled && marker.label
        ? cardNumber(point.value, { tier }).text
        : undefined,
  };
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

/** The indexes of `count` dates spread evenly from the first label to the last. */
function datesShown(labels: readonly string[], count: number): number[] {
  if (labels.length <= 1) return labels.length === 1 ? [0] : [];
  const steps = Math.min(count, labels.length) - 1;
  const indexes = Array.from({ length: steps + 1 }, (_, step) =>
    Math.round((step * (labels.length - 1)) / steps)
  );
  return [...new Set(indexes)];
}

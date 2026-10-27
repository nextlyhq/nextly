/**
 * The marks of a chart over time, drawn by the chart engine: one area, one line per series, or one
 * bar per interval, with its value axis, gridlines and dates where the card has room, each series'
 * latest point, and the interval in view.
 *
 * `OverTimeChart` loads this module lazily, so the engine reaches only the views that draw a chart,
 * and hands it plain data: no type of the engine's leaves this file. Everything a reader needs is
 * outside it -- the chart's name, description, table, keyboard and live region -- so the drawing is
 * hidden from assistive tech, and the engine's own keyboard layer is off: the chart is one tab
 * stop, and that stop is `ChartReachArea`'s.
 *
 * The pointer is read from the engine, which knows where each interval is drawn, and handed back
 * as an index; the interval in view comes back down as `shown`. So the pointer, the keys, the rule
 * and the tooltip all name an interval by one scale, the engine's.
 *
 * @module components/features/widgets/charts/drawn/over-time-drawing
 */

import type { JSX, ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { cardNumber } from "../../frame/format";
import {
  CHART_DATES_HEIGHT as DATES_HEIGHT,
  chartConfigStyle,
  seriesColour,
  type ChartConfig,
} from "../chart-config";
import { usePrefersReducedMotion } from "../reduced-motion";

import {
  PointerIndex,
  TOOLTIP_MARK,
  usePointerIndex,
  useStableValue,
} from "./pointer-index";

/** A series' latest point, marked: where it is, and its value written beside it or not. */
export interface OverTimeLatest {
  index: number;
  value: number;
  /** The value as written beside the point; `undefined` draws the point alone. */
  label: string | undefined;
}

export interface OverTimeDrawingProps {
  /** One row per interval, oldest first: its key, and each series' value there or `null`. */
  rows: ReadonlyArray<{
    key: string;
    label: string;
    values: ReadonlyArray<number | null>;
  }>;
  /** The series, keyed `s0`, `s1`, … in the order of each row's values. */
  config: ChartConfig;
  /** A single series as an area or bars; several series as lines. */
  style: "area" | "lines" | "bars";
  /** Whether the value axis, gridlines and dates are drawn: not on a small card. */
  axes: boolean;
  /** The intervals whose dates are written under the chart, by index. */
  dates: readonly number[];
  /** Each series' latest point, by series; `undefined` where it is not marked. */
  latest: ReadonlyArray<OverTimeLatest | undefined>;
  /** The interval in view, from the pointer or the keys; `undefined` for none. */
  shown: number | undefined;
  /** The pointer is over the interval at `index`. */
  onHover: (index: number) => void;
  /** What the tooltip says about the interval in view. */
  tooltip: ReactNode;
  /** The drawing's height in pixels, the axes included. */
  height: number;
}

/** The line's weight, and the ring of a marked point, in pixels. */
const STROKE = 2.4;
const POINT_RADIUS = 4.5;
/** Room for the value axis's labels, and for a mark at either end. */
const AXIS_WIDTH = 28;
const EDGE = 6;
/** The room between the interval in view and its tooltip. */
const TOOLTIP_GAP = 8;

/** How the date at `index` of `count` is anchored: the first at its start, the last at its end. */
function dateAnchor(index: number, count: number): "start" | "middle" | "end" {
  if (count > 1 && index === 0) return "start";
  if (count > 1 && index === count - 1) return "end";
  return "middle";
}

export default function OverTimeDrawing({
  rows,
  config,
  style,
  axes,
  dates,
  latest,
  shown,
  onHover,
  tooltip,
  height,
}: OverTimeDrawingProps): JSX.Element {
  const animate = !usePrefersReducedMotion();
  const pointer = usePointerIndex(onHover);
  const keys = Object.keys(config);
  const data = useStableValue(
    rows.map(row => ({
      key: row.key,
      label: row.label,
      ...Object.fromEntries(keys.map((key, index) => [key, row.values[index]])),
    }))
  );
  const dateKeys = dates.flatMap(index => rows[index]?.key ?? []);
  const labelOf = new Map(rows.map(row => [row.key, row.label]));

  return (
    <div
      aria-hidden="true"
      data-testid="chart-drawing"
      className="relative"
      data-motion={animate ? "animated" : "reduced"}
      onMouseMove={pointer.onMouseMove}
      // design-lint-ok: each series' colour, set once from its chart slot's token.
      style={chartConfigStyle(config)}
    >
      {/* The engine never sees the pointer, and draws no tooltip (`pointer-index`): the pointer
          is read above it (`usePointerIndex`), and the tooltip below is the chart's own, so it
          stays on its mark while a reader moves onto it (WCAG 2.2 1.4.13). */}
      <ResponsiveContainer
        width="100%"
        height={height}
        initialDimension={{ width: 320, height }}
        className="pointer-events-none"
      >
        <ComposedChart
          data={data}
          accessibilityLayer={false}
          margin={{ top: EDGE, right: EDGE, bottom: 0, left: axes ? 0 : EDGE }}
        >
          {axes ? (
            <CartesianGrid vertical={false} stroke="var(--nx-border)" />
          ) : null}
          <XAxis
            dataKey="key"
            hide={!axes}
            height={DATES_HEIGHT}
            ticks={dateKeys}
            interval={0}
            // The first date starts at the range's start and the last ends at its end, so
            // neither runs past the drawing or over the value axis; any between are centred.
            tick={({ x, y, payload, index }) => (
              <text
                x={Number(x)}
                y={Number(y)}
                dy="0.71em"
                fontSize={10}
                fill="var(--nx-muted-foreground)"
                textAnchor={dateAnchor(index, dateKeys.length)}
              >
                {labelOf.get(String(payload.value)) ?? ""}
              </text>
            )}
            tickLine={false}
            axisLine={false}
            padding={style === "bars" ? undefined : { left: 0, right: 0 }}
          />
          <YAxis
            hide={!axes}
            width={AXIS_WIDTH}
            domain={[0, "auto"]}
            tickCount={3}
            allowDecimals={false}
            // As drawn, "1.2k": the axis is hidden from assistive tech, which reads the table.
            tickFormatter={value => cardNumber(Number(value)).text}
            tick={{ fontSize: 10, fill: "var(--nx-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <PointerIndex
            axis="x"
            keys={rows.map(row => row.key)}
            into={pointer.into}
          />
          {shown === undefined ? null : (
            <InView row={data[shown]} keys={keys} rowKey={rows[shown]?.key} />
          )}
          {keys.map(key => (
            <SeriesMarks
              key={key}
              dataKey={key}
              style={style}
              animate={animate}
            />
          ))}
          {latestDots(latest, keys, rows)}
        </ComposedChart>
      </ResponsiveContainer>
      <TooltipBox
        shown={shown}
        count={rows.length}
        banded={style === "bars"}
        axes={axes}
      >
        {tooltip}
      </TooltipBox>
    </div>
  );
}

/**
 * Each series' latest point, ringed, with its value written beside it where it is labelled: on its
 * right in the left half of the range and on its left otherwise, so it stays on the card. Elements,
 * not a component, so the engine sees each mark as its chart's own.
 */
function latestDots(
  latest: OverTimeDrawingProps["latest"],
  keys: readonly string[],
  rows: OverTimeDrawingProps["rows"]
): JSX.Element[] {
  return latest.flatMap((point, index) => {
    const key = keys[index];
    const row = point ? rows[point.index] : undefined;
    if (!point || !key || !row) return [];
    return [
      <ReferenceDot
        key={key}
        x={row.key}
        y={point.value}
        r={POINT_RADIUS}
        fill="var(--nx-card)"
        stroke={seriesColour(key)}
        strokeWidth={STROKE}
        ifOverflow="visible"
        label={latestLabel(point, rows.length)}
      />,
    ];
  });
}

/** The latest point's written value, or nothing where it is not labelled. */
function latestLabel(point: OverTimeLatest, count: number) {
  if (point.label === undefined) return undefined;
  return {
    value: point.label,
    position: point.index * 2 < count ? ("right" as const) : ("left" as const),
    offset: POINT_RADIUS + 4,
    fontSize: 10,
    fontWeight: 500,
    fill: "var(--nx-foreground)",
  };
}

/** The tooltip of the interval in view, beside it, while one is in view. */
function TooltipBox({
  shown,
  count,
  banded,
  axes,
  children,
}: {
  shown: number | undefined;
  count: number;
  banded: boolean;
  axes: boolean;
  children: ReactNode;
}): JSX.Element | null {
  if (shown === undefined || children === null) return null;
  return (
    <div
      {...TOOLTIP_MARK}
      className="absolute top-0 z-10"
      // design-lint-ok: placed beside the interval in view, on the side the chart has room.
      style={tooltipPlace(shown, count, banded, axes)}
    >
      {children}
    </div>
  );
}

/**
 * The interval in view, drawn by the engine on its own scale: a dashed rule through it, and each
 * series' point there ringed in its colour.
 */
function InView({
  row,
  keys,
  rowKey,
}: {
  row: Record<string, unknown> | undefined;
  keys: readonly string[];
  rowKey: string | undefined;
}): JSX.Element | null {
  if (!row || rowKey === undefined) return null;
  return (
    <>
      <ReferenceLine
        x={rowKey}
        stroke="var(--nx-muted-foreground)"
        strokeDasharray="3 3"
        className="chart-rule"
      />
      {keys.flatMap(key => {
        const value = row[key];
        return typeof value === "number"
          ? [
              <ReferenceDot
                key={key}
                x={rowKey}
                y={value}
                r={POINT_RADIUS}
                fill="var(--nx-card)"
                stroke={seriesColour(key)}
                strokeWidth={STROKE}
                ifOverflow="visible"
                className="chart-point-in-view"
              />,
            ]
          : [];
      })}
    </>
  );
}

/** How far across the plot the interval at `index` of `count` is drawn, 0 to 1. */
function acrossOf(index: number, count: number, banded: boolean): number {
  if (banded) return (index + 0.5) / Math.max(1, count);
  return count > 1 ? index / (count - 1) : 0;
}

/**
 * Where the tooltip of the interval at `index` of `count` sits: beside it, on its left side when
 * the interval is in the right half and on its right side otherwise, so it stays on the card.
 * Placed as the engine places the interval: points evenly from the plot's left edge to its right,
 * or each bar in the middle of its own band; the plot starts after the value axis where there is one.
 */
function tooltipPlace(
  index: number,
  count: number,
  banded: boolean,
  axes: boolean
): { left: string } | { right: string } {
  const across = acrossOf(index, count, banded);
  const start = axes ? AXIS_WIDTH : EDGE;
  const plot = `(100% - ${start + EDGE}px)`;
  return across <= 0.5
    ? { left: `calc(${start + TOOLTIP_GAP}px + ${plot} * ${across})` }
    : { right: `calc(${EDGE + TOOLTIP_GAP}px + ${plot} * ${1 - across})` };
}

/**
 * One series' marks in its colour: an area under its line for a single series, bars for a single
 * series drawn as bars, and a line among several.
 */
function SeriesMarks({
  dataKey,
  style,
  animate,
}: {
  dataKey: string;
  style: OverTimeDrawingProps["style"];
  animate: boolean;
}): JSX.Element {
  const colour = seriesColour(dataKey);
  if (style === "bars") {
    return (
      <Bar
        dataKey={dataKey}
        fill={colour}
        radius={[3, 3, 0, 0]}
        maxBarSize={24}
        isAnimationActive={animate}
      />
    );
  }
  if (style === "area") {
    return (
      <Area
        type="linear"
        dataKey={dataKey}
        stroke={colour}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        fill={colour}
        fillOpacity={0.16}
        dot={false}
        activeDot={false}
        connectNulls={false}
        isAnimationActive={animate}
      />
    );
  }
  return (
    <Line
      type="linear"
      dataKey={dataKey}
      stroke={colour}
      strokeWidth={STROKE}
      strokeLinejoin="round"
      dot={false}
      activeDot={false}
      connectNulls={false}
      isAnimationActive={animate}
    />
  );
}

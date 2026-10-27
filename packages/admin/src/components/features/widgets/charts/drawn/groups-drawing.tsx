/**
 * The marks of a chart of groups, drawn by the chart engine: one row per group, its name, its bar
 * on a full-width track and its count, longest first.
 *
 * `GroupsChart` loads this module lazily, so the engine reaches only the views that draw a chart,
 * and hands it plain data: no type of the engine's leaves this file. The drawing is hidden from
 * assistive tech and the engine's own keyboard layer is off, since the chart's name, description,
 * table, keys and live region are `GroupsChart`'s, outside it.
 *
 * A name longer than its column ends in "…"; the tooltip and the table hold it whole. The names
 * and the counts are each a category axis over the same rows, so a row's name, bar and count
 * cannot drift apart.
 *
 * @module components/features/widgets/charts/drawn/groups-drawing
 */

import type { JSX, ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Text,
  XAxis,
  YAxis,
} from "recharts";

import {
  chartConfigStyle,
  CHART_ROW_HEIGHT,
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

/** One drawn group: its key in the config, its name, its count as written, and its bar's share. */
export interface GroupsDrawnRow {
  key: string;
  label: string;
  /** Written in italic, muted: the group that stands for no value. */
  placeholder: boolean;
  /** The count as drawn, "2,000+" or "1.2k". */
  count: string;
  /** The bar's length as a share of the longest, 0 to 1. */
  fraction: number;
}

export interface GroupsDrawingProps {
  rows: readonly GroupsDrawnRow[];
  /** Each group's colour, by its key. */
  config: ChartConfig;
  /** The group in view, from the pointer or the keys; `undefined` for none. */
  shown: number | undefined;
  /** The pointer is over the group at `index`. */
  onHover: (index: number) => void;
  /** What the tooltip says about the group in view. */
  tooltip: ReactNode;
}

/** The name's column and the count's, in pixels: the approved layout's 80 and its counts. */
const NAME_WIDTH = 80;
const COUNT_WIDTH = 36;
const BAR_HEIGHT = 8;
/** How far the engine sets an axis's tick from the axis line. */
const TICK_MARGIN = 8;
/**
 * The name's size as the engine measures it to decide where "…" goes. It measures in a span of
 * its own, styled from this alone, so without it a name is measured at the page's default size
 * and cut although it fits.
 */
const NAME_TEXT = { fontSize: 12 } as const;

export default function GroupsDrawing({
  rows,
  config,
  shown,
  onHover,
  tooltip,
}: GroupsDrawingProps): JSX.Element {
  const animate = !usePrefersReducedMotion();
  const pointer = usePointerIndex(onHover);
  const byKey = new Map(rows.map(row => [row.key, row]));
  const height = rows.length * CHART_ROW_HEIGHT;
  const data = useStableValue(rows.map(row => ({ ...row })));

  return (
    <div
      aria-hidden="true"
      data-testid="chart-drawing"
      className="relative"
      data-motion={animate ? "animated" : "reduced"}
      onMouseMove={pointer.onMouseMove}
      // design-lint-ok: each group's colour, set once from its chart slot's token.
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
        <BarChart
          data={data}
          layout="vertical"
          accessibilityLayer={false}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={CHART_ROW_HEIGHT - BAR_HEIGHT}
        >
          <XAxis type="number" domain={[0, 1]} hide />
          <YAxis
            yAxisId="name"
            type="category"
            dataKey="key"
            width={NAME_WIDTH}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={({ y, payload }) => {
              const row = byKey.get(String(payload.value));
              // From the drawing's left edge, where the name's column starts.
              return (
                <Text
                  x={0}
                  y={Number(y)}
                  width={NAME_WIDTH - 8}
                  maxLines={1}
                  style={NAME_TEXT}
                  textAnchor="start"
                  verticalAnchor="middle"
                  fontSize={12}
                  fontStyle={row?.placeholder ? "italic" : "normal"}
                  fill={
                    row?.placeholder
                      ? "var(--nx-muted-foreground)"
                      : "var(--nx-foreground)"
                  }
                >
                  {row?.label ?? ""}
                </Text>
              );
            }}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            type="category"
            dataKey="count"
            width={COUNT_WIDTH}
            tickLine={false}
            axisLine={false}
            interval={0}
            // Ended at the drawing's right edge: the engine places a right axis's tick a margin
            // in from the axis, and the count's column is the axis's width.
            tick={{
              fontSize: 12,
              fill: "var(--nx-muted-foreground)",
              textAnchor: "end",
              dx: COUNT_WIDTH - TICK_MARGIN,
            }}
          />
          <PointerIndex
            axis="y"
            axisId="name"
            keys={rows.map(row => row.key)}
            into={pointer.into}
          />
          <Bar
            yAxisId="name"
            dataKey="fraction"
            barSize={BAR_HEIGHT}
            radius={BAR_HEIGHT / 2}
            background={{ fill: "var(--nx-muted)", radius: BAR_HEIGHT / 2 }}
            isAnimationActive={animate}
          >
            {rows.map(row => (
              <Cell key={row.key} fill={seriesColour(row.key)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {shown === undefined || tooltip === null ? null : (
        <div
          {...TOOLTIP_MARK}
          className="absolute z-10"
          // design-lint-ok: placed against the row in view, on the side the chart has room.
          style={tooltipPlace(shown, rows.length)}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

/**
 * Where the tooltip of the row at `index` of `count` sits: from the bar's start, under the row in
 * the top half and over it in the bottom half, so it stays on the card.
 */
function tooltipPlace(
  index: number,
  count: number
): { left: string; top: string } | { left: string; bottom: string } {
  const left = `${NAME_WIDTH}px`;
  return index * 2 < count
    ? { left, top: `${(index + 1) * CHART_ROW_HEIGHT}px` }
    : { left, bottom: `${(count - index) * CHART_ROW_HEIGHT}px` };
}

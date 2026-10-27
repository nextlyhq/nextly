/**
 * The marks of a chart of groups, drawn by the chart engine: one row per group, its name, its bar
 * on a full-width track and its count, longest first.
 *
 * `GroupsChart` loads this module lazily, so the engine reaches only the views that draw a chart,
 * and hands it plain data: no type of the engine's leaves this file. The drawing is hidden from
 * assistive tech and the engine's own keyboard layer is off, since the chart's name, description,
 * table, keys and live region are `GroupsChart`'s, outside it.
 *
 * The rows share the card's body: each takes an equal part of its height, and its bar thickens
 * with the row up to `MAX_BAR`, so a few groups fill a tall card without a block of bars at its
 * top, and many keep their bars apart. A name longer than its column ends in "…"; the tooltip and
 * the table hold it whole. The names and the counts are each a category axis over the same rows,
 * so a row's name, bar and count cannot drift apart.
 *
 * @module components/features/widgets/charts/drawn/groups-drawing
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
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

import { fitName } from "./fit-name";
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
/** The room between a name and its bar. */
const NAME_GAP = 8;
/** A bar is never thicker than this, however tall its row: past it, rows only move apart. */
const MAX_BAR = 16;
/** The share of a row the gap around its bar takes, so a bar is under half its row's height. */
const ROW_GAP = "55%";
/** How far the engine sets an axis's tick from the axis line. */
const TICK_MARGIN = 8;
/** The tooltip's room from the bar's end. */
const TOOLTIP_GAP = 8;
/** The names' size, as drawn and as measured for "…". */
const NAME_SIZE = 12;

export default function GroupsDrawing({
  rows,
  config,
  shown,
  onHover,
  tooltip,
}: GroupsDrawingProps): JSX.Element {
  const animate = !usePrefersReducedMotion();
  const pointer = usePointerIndex(onHover);
  const font = useDrawnFont();
  const byKey = new Map(rows.map(row => [row.key, row]));
  const minHeight = rows.length * CHART_ROW_HEIGHT;
  const data = useStableValue(rows.map(row => ({ ...row })));

  return (
    <div
      ref={font.ref}
      aria-hidden="true"
      data-testid="chart-drawing"
      className="relative min-h-0 flex-1"
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
        height="100%"
        minHeight={minHeight}
        initialDimension={{ width: 320, height: minHeight }}
        className="pointer-events-none"
      >
        <BarChart
          data={data}
          layout="vertical"
          accessibilityLayer={false}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={ROW_GAP}
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
            tick={({ y, payload }) => (
              <GroupName
                row={byKey.get(String(payload.value))}
                y={Number(y)}
                font={font.value}
              />
            )}
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
              fontSize: NAME_SIZE,
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
          {/* Rounded by half the bar's thickness, whatever the row makes it: the engine holds a
              corner's radius to half the bar. */}
          <Bar
            yAxisId="name"
            dataKey="fraction"
            maxBarSize={MAX_BAR}
            radius={MAX_BAR / 2}
            background={{ fill: "var(--nx-muted)", radius: MAX_BAR / 2 }}
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
          // design-lint-ok: placed in the neighbouring row, from the bar's end, so it covers
          // neither the bar it describes nor the names.
          style={tooltipPlace(shown, rows)}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

/**
 * The font the drawing's text is set in, read from the page once the drawing is laid out, for
 * measuring a name: the size the names are drawn at, in the drawing's own family.
 */
function useDrawnFont(): {
  ref: (element: HTMLDivElement | null) => void;
  value: string;
} {
  const element = useRef<HTMLDivElement | null>(null);
  const [family, setFamily] = useState("sans-serif");
  useLayoutEffect(() => {
    const drawn = element.current;
    if (drawn) setFamily(getComputedStyle(drawn).fontFamily || "sans-serif");
  }, []);
  return {
    ref: drawn => {
      element.current = drawn;
    },
    value: `${NAME_SIZE}px ${family}`,
  };
}

/** A group's name from the drawing's left edge, cut to its column in the font it is drawn in. */
function GroupName({
  row,
  y,
  font,
}: {
  row: GroupsDrawnRow | undefined;
  y: number;
  font: string;
}): JSX.Element {
  return (
    <text
      x={0}
      y={y}
      dy="0.355em"
      textAnchor="start"
      fontSize={NAME_SIZE}
      fontStyle={row?.placeholder ? "italic" : "normal"}
      fill={
        row?.placeholder ? "var(--nx-muted-foreground)" : "var(--nx-foreground)"
      }
    >
      {row ? fitName(row.label, NAME_WIDTH - NAME_GAP, font) : ""}
    </text>
  );
}

/**
 * Where the tooltip of the row at `index` sits: in the row under it in the top half of the chart
 * and in the row over it in the bottom half, so it stays on the card and never covers its own bar;
 * across, from that bar's end, so it points at it, or ending there when the bar is long, and never
 * over the names. Rows share the height evenly, so a row's place is a share of it.
 */
function tooltipPlace(
  index: number,
  rows: readonly GroupsDrawnRow[]
): Record<string, string> {
  const count = Math.max(1, rows.length);
  const fraction = rows[index]?.fraction ?? 0;
  const track = `(100% - ${NAME_WIDTH + COUNT_WIDTH}px)`;
  const across =
    fraction <= 0.5
      ? {
          left: `calc(${NAME_WIDTH + TOOLTIP_GAP}px + ${track} * ${fraction})`,
        }
      : {
          right: `calc(${COUNT_WIDTH + TOOLTIP_GAP}px + ${track} * ${1 - fraction})`,
        };
  const down =
    index * 2 < count
      ? { top: `${((index + 1) / count) * 100}%` }
      : { bottom: `${((count - index) / count) * 100}%` };
  return { ...across, ...down };
}

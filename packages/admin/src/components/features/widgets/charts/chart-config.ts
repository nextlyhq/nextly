/**
 * A chart's series config, built the way shadcn builds its charts: each series' key in the drawn
 * data mapped to what it is called and its chart colour.
 *
 * The chart's container sets each series' colour once, as `--color-<key>`, and every mark reads
 * it from there, so a line, its area and its point in view cannot draw one series in two colours.
 * Keys are the chart's own (`s0`, `s1`, … and `count`), never a stored value, so each is a valid
 * CSS name whatever the data holds.
 *
 * Free of the chart engine: the charts that load the engine lazily build their config here first.
 *
 * @module components/features/widgets/charts/chart-config
 */

import type { CSSProperties } from "react";

import { chartColour, type ChartSlot } from "./chart-colour";

/**
 * A chart's sizes in pixels, here rather than beside the drawing so a chart can hold its place
 * while the engine loads without importing the engine: a chart over time's marks and the row of
 * dates under them, and one row of a chart of groups, its name, bar and count with the gap below.
 */
export const CHART_PLOT_HEIGHT = 64;
export const CHART_DATES_HEIGHT = 18;
export const CHART_ROW_HEIGHT = 22;

/** One series: what it is called, and the chart colour it is drawn in. */
export interface ChartSeriesConfig {
  label: string;
  slot: ChartSlot;
}

/** Every series of one chart, by its key in the drawn data. */
export type ChartConfig = Readonly<Record<string, ChartSeriesConfig>>;

/** The key of the series at `index` in the drawn data. */
export function seriesKey(index: number): string {
  return `s${index}`;
}

/** The CSS variables a chart's container sets: one colour per series, from its slot's token. */
export function chartConfigStyle(config: ChartConfig): CSSProperties {
  return Object.fromEntries(
    Object.entries(config).map(([key, series]) => [
      `--color-${key}`,
      chartColour(series.slot),
    ])
  );
}

/** The colour a mark of the series `key` is drawn in, as its container set it. */
export function seriesColour(key: string): string {
  return `var(--color-${key})`;
}

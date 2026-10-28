/**
 * The widget kit: the components and functions core's own dashboard cards are drawn with, for a
 * widget's own view (`defineWidget` with `view: { component }`), published to plugins through
 * `@nextlyhq/plugin-sdk/admin` only.
 *
 * - `Widget.Figure`, `Widget.List`, `Widget.Table`, `Widget.BarChart` and `Widget.SeriesChart`:
 *   the body-level parts of a card, each reading the card's size tier and the admin's theme
 *   tokens, so a plugin's card matches core's beside it in light and dark. The frame and every
 *   state around the body are the host's.
 *
 * The number and change formatters and the chart colour accessor are not here: they are
 * published from `@nextlyhq/plugin-sdk`'s server-safe root, since every module of the admin is
 * a client module and a Server Component could not call one.
 *
 * Each part IS core's own, under the name a plugin uses: a second implementation would drift
 * from the cards core draws.
 *
 * @module components/features/widgets/kit
 */

import type { ChartUnit } from "../charts/chart-unit";
import {
  GroupsChart,
  type GroupsChartGroup,
  type GroupsChartProps,
} from "../charts/groups-chart";
import {
  OverTimeChart,
  type OverTimeChartProps,
  type OverTimeInterval,
  type OverTimePoint,
  type OverTimeSeries,
} from "../charts/over-time-chart";
import { CardFigure } from "../frame/figure";

import { WidgetList, WidgetTable } from "./list";

export type {
  WidgetListProps,
  WidgetListTotal,
  WidgetRowAction,
  WidgetTableColumn,
  WidgetTableProps,
} from "./list";

/** The props of `Widget.Figure`. */
export type WidgetFigureProps = Parameters<typeof CardFigure>[0];
/** The props of `Widget.BarChart`. */
export type WidgetBarChartProps = GroupsChartProps;
/** One bar of `Widget.BarChart`. */
export type WidgetBarChartGroup = GroupsChartGroup;
/** The props of `Widget.SeriesChart`. */
export type WidgetSeriesChartProps = OverTimeChartProps;
/** One line of `Widget.SeriesChart`. */
export type WidgetSeries = OverTimeSeries;
/** One point of a `Widget.SeriesChart` line. */
export type WidgetSeriesPoint = OverTimePoint;
/** One interval of `Widget.SeriesChart`'s axis. */
export type WidgetSeriesInterval = OverTimeInterval;
/** What a chart's numbers count, written after each in its tooltip: "12 new posts". */
export type WidgetChartUnit = ChartUnit;

/** The shape of `Widget`: each part, typed as the component core's cards use. */
export interface WidgetKit {
  readonly Figure: typeof CardFigure;
  readonly List: typeof WidgetList;
  readonly Table: typeof WidgetTable;
  readonly BarChart: typeof GroupsChart;
  readonly SeriesChart: typeof OverTimeChart;
}

/**
 * The parts of a card's body core's own cards are drawn with.
 *
 * - `Figure`: one number, written for the card's tier ("1.2k" on a small card) and heard in
 *   full.
 * - `List`: rows of a title, up to three fields and an end, with one action each.
 * - `Table`: rows across named columns, a table on a wide card.
 * - `BarChart`: one bar per group, longest first, with an optional `unit` for its tooltip.
 * - `SeriesChart`: one line per series over time, with an optional `unit`.
 */
export const Widget: WidgetKit = Object.freeze({
  Figure: CardFigure,
  List: WidgetList,
  Table: WidgetTable,
  BarChart: GroupsChart,
  SeriesChart: OverTimeChart,
});

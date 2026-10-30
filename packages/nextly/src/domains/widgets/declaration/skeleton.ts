/**
 * The shapes a declared widget's card may say it loads in (`skeleton`), and
 * the add panel's sketch each one is drawn with: the one table both the
 * startup check and the published definition read, so a shape a declaration
 * may state is always one the admin can draw.
 *
 * @module domains/widgets/declaration/skeleton
 */

import type { DataWidgetArchetype } from "../definition";

/**
 * Each skeleton a declaration may state, and the display the admin draws it
 * as: the loading state's shape and the add panel's sketch alike.
 */
export const WIDGET_SKELETON_SKETCH = {
  figure: "metric",
  list: "list",
  bars: "bars",
  series: "timeseries",
  table: "table",
} as const satisfies Record<string, DataWidgetArchetype>;

/**
 * What a card's loading state is shaped like, and the sketch the add panel
 * draws its row with: a number, a list, bars, a series over time, or a table.
 *
 * @experimental
 */
export type WidgetSkeleton = keyof typeof WIDGET_SKELETON_SKETCH;

/** Whether a value is one of the skeletons a declaration may state. */
export function isWidgetSkeleton(value: unknown): value is WidgetSkeleton {
  return (
    typeof value === "string" && Object.hasOwn(WIDGET_SKELETON_SKETCH, value)
  );
}

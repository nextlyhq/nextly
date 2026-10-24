/**
 * The widths each of core's dashboard cards starts at and may take: the agreed
 * table, in one place.
 *
 * Read by the declarations (`core-widgets.ts`) and by the retirement map
 * (`layout.ts`), which needs the successor's widths to pick a converted card's
 * width. Kept apart from both so neither imports the other, and so the two can
 * never state different widths for one card.
 *
 * @module domains/widgets/core-widget-widths
 */

import type { WidgetWidth } from "./widths";

/** A card's widths: the one a new card starts at, and every one it may take. */
export interface CoreWidgetWidths {
  defaultWidth: WidgetWidth;
  allowedWidths: readonly WidgetWidth[];
}

const THIRD_TO_FULL: readonly WidgetWidth[] = [
  "third",
  "half",
  "twoThirds",
  "full",
];

export const NEEDS_ATTENTION_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "twoThirds",
  allowedWidths: THIRD_TO_FULL,
};

export const CREATE_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "third",
  allowedWidths: THIRD_TO_FULL,
};

export const RECENTLY_EDITED_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "half",
  allowedWidths: THIRD_TO_FULL,
};

export const RECENT_ACTIVITY_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "half",
  allowedWidths: THIRD_TO_FULL,
};

export const CONTENT_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "full",
  allowedWidths: ["half", "twoThirds", "full"],
};

export const UPCOMING_RELEASES_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "third",
  allowedWidths: ["third", "half", "twoThirds"],
};

export const TEAM_WIDTHS: CoreWidgetWidths = {
  defaultWidth: "third",
  allowedWidths: ["quarter", "third", "half"],
};

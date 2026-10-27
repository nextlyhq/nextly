/**
 * Every one of core's widget ids, in core's order, without the widgets.
 *
 * Kept apart from the widgets so that code asking only whether an id is
 * core's, and where it sorts, does not load every core card to ask: the site
 * dashboard's declaration check runs wherever a config is read, the CLI
 * included, and reached the widgets through this list. The index holds this
 * list equal to its widgets' own ids, in order, at compile time, so a widget
 * added, renamed or removed there fails the build until this list moves too.
 *
 * @module domains/widgets/core-widgets/ids
 */

export const CORE_WIDGET_IDS = [
  "core/get-started",
  "core/content",
  "core/quick-create",
  "core/team",
  "core/needs-attention",
  "core/recently-edited",
  "core/upcoming-releases",
  "core/recent-activity",
  "core/count",
  "core/breakdown",
  "core/note",
  "core/recent-entries",
  "core/over-time",
] as const;

/** The id of one of core's widgets. */
export type CoreWidgetId = (typeof CORE_WIDGET_IDS)[number];

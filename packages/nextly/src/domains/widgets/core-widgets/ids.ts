/**
 * Core's widget ids: the one place each is spelled, and core's order.
 *
 * Kept apart from the widgets, and importing nothing, so that code asking only
 * whether an id is core's, and where it sorts, does not load every core card
 * to ask: the site dashboard's declaration check runs wherever a config is
 * read, the CLI included. Each widget takes its `id` from {@link
 * CORE_WIDGET_ID}, and the index builds core's widgets in the order of
 * {@link CORE_WIDGET_IDS}, so an id is renamed, and a card moved, here and
 * nowhere else.
 *
 * @module domains/widgets/core-widgets/ids
 */

/** Each core widget's id, by name. */
export const CORE_WIDGET_ID = {
  getStarted: "core/get-started",
  content: "core/content",
  quickCreate: "core/quick-create",
  team: "core/team",
  needsAttention: "core/needs-attention",
  recentlyEdited: "core/recently-edited",
  upcomingReleases: "core/upcoming-releases",
  recentActivity: "core/recent-activity",
  count: "core/count",
  breakdown: "core/breakdown",
  note: "core/note",
  recentEntries: "core/recent-entries",
  overTime: "core/over-time",
} as const;

/** The id of one of core's widgets. */
export type CoreWidgetId = (typeof CORE_WIDGET_ID)[keyof typeof CORE_WIDGET_ID];

/**
 * Every one of core's widget ids, in core's order: the one list of what is
 * core's, for every reader asking whether an id is a built-in and where it
 * sorts.
 *
 * The agreed default dashboard, in each widget's `defaultOrder`: Needs
 * attention, Create, Recently edited, Recent activity, Content, Upcoming
 * releases and Team, each at its agreed size, after the onboarding cards. The
 * cards that share a row share a height, so the default dashboard tiles: Needs
 * attention and Create at 3 rows, the two activity lists at 4, Upcoming
 * releases and Team at 4. `defaultOrder` is spaced by ten rather than numbered
 * one-by-one, so a card can be placed between two of these later without
 * renumbering the rest -- the reason it is a number and not an index.
 */
export const CORE_WIDGET_IDS = [
  CORE_WIDGET_ID.getStarted,
  CORE_WIDGET_ID.content,
  CORE_WIDGET_ID.quickCreate,
  CORE_WIDGET_ID.team,
  CORE_WIDGET_ID.needsAttention,
  CORE_WIDGET_ID.recentlyEdited,
  CORE_WIDGET_ID.upcomingReleases,
  CORE_WIDGET_ID.recentActivity,
  CORE_WIDGET_ID.count,
  CORE_WIDGET_ID.breakdown,
  CORE_WIDGET_ID.note,
  CORE_WIDGET_ID.recentEntries,
  CORE_WIDGET_ID.overTime,
] as const satisfies readonly CoreWidgetId[];

// Every id named above is in the order: a widget added to the names but not
// here fails to compile.
const everyIdOrdered: Exclude<
  CoreWidgetId,
  (typeof CORE_WIDGET_IDS)[number]
> extends never
  ? true
  : false = true;
void everyIdOrdered;

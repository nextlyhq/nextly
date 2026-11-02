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

import type { DefaultLayoutCard } from "../declaration/dashboard";

/** Each core widget's id, by name. */
export const CORE_WIDGET_ID = {
  setup: "core/setup",
  contentTable: "core/content-table",
  team: "core/team",
  needsAttention: "core/needs-attention",
  continue: "core/continue",
  upcomingReleases: "core/upcoming-releases",
  teamActivity: "core/team-activity",
  count: "core/count",
  breakdown: "core/breakdown",
  note: "core/note",
  recentEntries: "core/recent-entries",
  overTime: "core/over-time",
  systemHealth: "core/system-health",
} as const;

/** The id of one of core's widgets. */
export type CoreWidgetId = (typeof CORE_WIDGET_ID)[keyof typeof CORE_WIDGET_ID];

/**
 * Every one of core's widget ids, in core's order: the one list of what is
 * core's, for every reader asking whether an id is a built-in and where it
 * sorts. Which of them the default dashboard holds is `CORE_DEFAULT_LAYOUT`.
 */
export const CORE_WIDGET_IDS = [
  CORE_WIDGET_ID.setup,
  CORE_WIDGET_ID.contentTable,
  CORE_WIDGET_ID.team,
  CORE_WIDGET_ID.needsAttention,
  CORE_WIDGET_ID.continue,
  CORE_WIDGET_ID.upcomingReleases,
  CORE_WIDGET_ID.teamActivity,
  CORE_WIDGET_ID.count,
  CORE_WIDGET_ID.breakdown,
  CORE_WIDGET_ID.note,
  CORE_WIDGET_ID.recentEntries,
  CORE_WIDGET_ID.overTime,
  CORE_WIDGET_ID.systemHealth,
] as const satisfies readonly CoreWidgetId[];

/**
 * The ids an earlier core gave a card that one of core's widgets has since taken over, each with
 * the widget that took it over. A saved arrangement's card under a former id is read as the
 * current widget's, in its place (`readStoredLayout`), so a reader who arranged their dashboard
 * before the rename keeps the card, and their next save stores it under the current id.
 */
export const FORMER_CORE_WIDGET_IDS: ReadonlyMap<string, CoreWidgetId> =
  new Map<string, CoreWidgetId>([
    // "Get started" became the setup card's row of steps.
    ["core/get-started", CORE_WIDGET_ID.setup],
  ]);

/**
 * Core's widgets only a super-admin is told exist: neither offered to anyone
 * else, nor placed, nor handed as a card (`widgetAudience`). A super-admin is
 * not a permission, so no `requiredPermission` gate can say it, and an
 * `access` predicate is judged per card only, which would still offer the
 * widget to everyone. Here, beside the ids and importing nothing, so the
 * audience asks it without loading any card.
 */
export const SUPER_ADMIN_WIDGET_IDS: ReadonlySet<string> = new Set<string>([
  CORE_WIDGET_ID.setup,
  CORE_WIDGET_ID.systemHealth,
]);

// Every id named above is in the order: a widget added to the names but not
// here fails to compile.
const everyIdOrdered: Exclude<
  CoreWidgetId,
  (typeof CORE_WIDGET_IDS)[number]
> extends never
  ? true
  : false = true;
void everyIdOrdered;

/**
 * The form-builder plugin's New form submissions card: the one widget not
 * core's own that core's default names. Spelled here because core cannot
 * import the plugin; its entry is `optional`, so a site without the plugin
 * leaves the card out and starts with no fault.
 */
const FORM_SUBMISSIONS_WIDGET_ID = "form-builder/new-submissions";

/**
 * Core's own default dashboard, written as a site writes `defaultLayout`, so
 * there is one path to the default whoever wrote it. In grid order, twelve
 * columns to a row:
 *
 * 1. Set up your project, across the row;
 * 2. Needs attention (8) beside Upcoming releases (4): the near future in one
 *    band. When only one of the two is on show, the admin draws it across the
 *    whole row, never storing that width;
 * 3. Continue where you left off (6) beside Content (6);
 * 4. New form submissions (6) beside Team activity (6).
 *
 * Each entry states its size, so the default does not move when a widget's
 * own starting size (what the add panel places) changes. The cards that share
 * a row share a height, so the default tiles: two rows for the setup card, its
 * one row of steps, and four for every other row, the least Upcoming releases
 * and Team activity allow. Every size lies
 * within its widget's bounds, so none is clamped where it is placed.
 *
 * Team is not on it: it is for the people who manage the team, who add it
 * from the add panel. Nor is a Create card: creating an entry is the
 * header's New button. A site's own `defaultLayout` takes this one's place
 * whole.
 *
 * Here, beside the ids and importing no widget, so the site dashboard's check
 * and the default's builder read it without loading every core card.
 */
export const CORE_DEFAULT_LAYOUT: readonly DefaultLayoutCard[] = [
  { widget: CORE_WIDGET_ID.setup, w: 12, h: 2 },
  { widget: CORE_WIDGET_ID.needsAttention, w: 8, h: 4 },
  { widget: CORE_WIDGET_ID.upcomingReleases, w: 4, h: 4 },
  { widget: CORE_WIDGET_ID.continue, w: 6, h: 4 },
  { widget: CORE_WIDGET_ID.contentTable, w: 6, h: 4 },
  { widget: FORM_SUBMISSIONS_WIDGET_ID, w: 6, h: 4, optional: true },
  { widget: CORE_WIDGET_ID.teamActivity, w: 6, h: 4 },
];

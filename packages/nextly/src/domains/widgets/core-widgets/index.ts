/**
 * Core's own dashboard cards, as widgets.
 *
 * Every one but Create is declared with `defineWidget`, as a plugin declares
 * its own, and reaches the registry through the same call as everyone's
 * declarations (`registerDashboardWidgets`), under core: each card's data is
 * answered on the server by its declaration's `load`, as the person asking.
 * Create is still written as a definition until it is retired. Which of them
 * the default dashboard holds, and in what order, is `CORE_DEFAULT_LAYOUT` in
 * `./ids`, written as a site writes its own `defaultLayout`.
 *
 * Every card draws inside the shared frame, which draws its header, its
 * loading skeleton and every state but ready, so they read as one product.
 * `title` is what names the card in the layout editor, where a reader chooses
 * what to show.
 *
 * Each card drawn by its own component names it as a `core#` STRING, resolved
 * in the admin by `core-components.ts`. Nothing in either package can check
 * that the two agree -- neither depends on the other -- so a card naming a path
 * that was never registered draws the unresolved fallback, silently and only
 * for the reader who has it. `core-widget-components.test.ts` in the admin is
 * what holds the halves together; it reads this file.
 *
 * Deliberately no `access` gate on the cards that predate the widget grid but
 * one. Every one of those is visible to any authenticated admin, and adding a
 * gate would hide a card someone currently sees -- a behaviour change wearing
 * the costume of a refactor. The exception is `core/team`, decided rather than
 * inherited: it is for the people who manage the team, so it is offered to a
 * reader who may read people AND may add or change them (`TEAM_GATE`), and its
 * `system:team` source asks the same gate before it counts anyone.
 *
 * 🔴 A card added HERE is new to every reader, so that argument does not extend
 * to it: nothing is hidden that was previously visible, so the gate is decided
 * by what the CARD'S SOURCE does to a caller who may not see its rows. The two
 * cards added together answer that differently, and neither is the default:
 *
 * - `core/upcoming-releases` is gated. `ReleasesService.find` authorizes by
 *   THROWING, so an ungranted reader gets a card stuck in its error state
 *   rather than an empty one -- see its own note.
 * - `core/team-activity` is not. Its feed takes the caller's readable
 *   collections as a scope and defaults that scope to NOTHING, so a reader
 *   entitled to none of it would see an empty feed; a permission gate would
 *   instead hide the feed from anyone whose permissions happened to be narrow
 *   today. It is CONDITIONAL instead, like Continue where you left off: offered
 *   while the reader may read a collection or a Single (`content:present`),
 *   which is exactly when the feed has something it may draw.
 *
 * @module domains/widgets/core-widgets
 */

import type { WidgetDefinition } from "../definition";
import type { WidgetCondition } from "../lifecycle";

import { breakdownWidget } from "./breakdown";
import { contentTableWidget } from "./content-table";
import { continueWidget } from "./continue";
import { countWidget } from "./count";
import { CORE_WIDGET_ID } from "./ids";
import { needsAttentionWidget } from "./needs-attention";
import { noteWidget } from "./note";
import { overTimeWidget } from "./over-time";
import { recentEntriesWidget } from "./recent-entries";
import { setupWidget } from "./setup";
import { systemHealthWidget } from "./system-health";
import { teamWidget } from "./team";
import { teamActivityWidget } from "./team-activity";
import { upcomingReleasesWidget } from "./upcoming-releases";

/**
 * Core's widgets declared with `defineWidget`, as a plugin declares its own,
 * in core's order. Registered through the same call as everyone's
 * declarations, under core; each card's data is answered on the server by its
 * declaration's `load`.
 */
export const CORE_DECLARATIONS = [
  setupWidget,
  contentTableWidget,
  teamWidget,
  continueWidget,
  upcomingReleasesWidget,
  teamActivityWidget,
  countWidget,
  breakdownWidget,
  needsAttentionWidget,
  noteWidget,
  recentEntriesWidget,
  overTimeWidget,
  systemHealthWidget,
] as const;

/**
 * When each of core's declared widgets that is not always offered is offered,
 * by its id: core's own conditions, handed to the one call with core's
 * declarations and published on each as its `lifecycle` and `visibleWhen`, so
 * the add panel offers the widget, and the layout's visibility token counts
 * it, exactly while its condition holds. Internal to core: a plugin's
 * declaration has no field for a condition.
 */
export const CORE_CONDITIONS: Readonly<Record<string, WidgetCondition>> = {
  // Offered only while this reader has a collection or a Single to see that
  // is neither internal nor hidden: a reader with nothing to list is not shown
  // an empty table.
  [CORE_WIDGET_ID.contentTable]: "content:present",
  // With no collection or Single the reader may read, nobody's saves could
  // reach a row, and the card would only ever say so.
  [CORE_WIDGET_ID.continue]: "content:present",
  // The feed leaves out every event about anything the reader may not read,
  // so with no collection or Single to read it could never draw a row.
  [CORE_WIDGET_ID.teamActivity]: "content:present",
  // Once a release exists that the reader may read, not as an empty card on a
  // site that has never made one; beside its gate, which is about access.
  [CORE_WIDGET_ID.upcomingReleases]: "releases:present",
};

/** Core's widgets still written as definitions: every one not declared. */
const CORE_WIDGET_LITERALS = [] as const satisfies readonly WidgetDefinition[];

/**
 * Core's widgets still written as definitions, as every reader of a
 * definition sees them.
 *
 * The same array as `CORE_WIDGET_LITERALS`, typed as definitions: callers
 * read optional fields (`requiredPermission`, `lifecycle`) that a literal type
 * would only have on the entries that set them. NOT every core widget: read
 * core's ids from `CORE_WIDGET_IDS`.
 */
export const CORE_WIDGETS: readonly WidgetDefinition[] = CORE_WIDGET_LITERALS;

// Core's widget ids, and their order, live in `./ids`, which imports nothing:
// re-exported for the readers that load the widgets anyway.
export { CORE_WIDGET_IDS } from "./ids";

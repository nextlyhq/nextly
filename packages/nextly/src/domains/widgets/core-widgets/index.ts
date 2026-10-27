/**
 * Core's own dashboard cards, as widgets.
 *
 * These are the widget system's FIRST consumers. Everything the grid can do --
 * the archetypes, the batched query path, the permission gate, the registry --
 * shipped before anything declared a widget, so a real dashboard drew none and
 * the whole grid rendered nothing. The cards a user actually sees were
 * hardcoded above it in `pages/dashboard/index.tsx`, which meant a layout the
 * reader could arrange would have arranged the empty half.
 *
 * They go through `registerWidget`, the same door a plugin uses, rather than an
 * admin-side list the server cannot see. That is what lets a plugin
 * `extendWidget("core/team", ...)` to tighten a permission or relabel a card --
 * and it is why `defaultOrder` exists: registrations resolve after
 * contributions, so without a declared position core's cards would sit BELOW
 * every plugin's, which is not the dashboard anyone has today.
 *
 * Collections, Singles and Team draw inside the shared frame like every other
 * card, so they read as one product. The other `custom` ones still carry
 * `chrome: "none"` until each moves into the frame: each draws a titled section
 * with its own rules, loading skeleton and error state. `title` is still required and
 * still meaningful -- it is what names the card in the layout editor, where a
 * reader chooses what to show. Stated as a property of that group rather than
 * as a count, because the count was written as "all four" and was wrong by two
 * before anyone reread it.
 *
 * Each `custom` card names its body as a `core#` STRING, resolved in the admin
 * by `core-components.ts`. Nothing in either package can check that the two
 * agree -- neither depends on the other -- so a card naming a path that was
 * never registered draws the unresolved fallback, silently and only for the
 * reader who has it. `core-widget-components.test.ts` in the admin is what
 * holds the halves together; it reads this file.
 *
 * Deliberately no `requiredPermission` on the cards that predate the widget
 * grid but one. Every one of those is visible to any authenticated admin, and
 * adding a gate would hide a card someone currently sees -- a behaviour change
 * wearing the costume of a refactor. The exception is `core/team`, decided
 * rather than inherited: it is for the people who manage the team, so it is
 * offered to a reader who may read people AND may add or change them
 * (`TEAM_GATE`), and its `system:team` source asks the same gate before it
 * counts anyone.
 *
 * 🔴 A card added HERE is new to every reader, so that argument does not extend
 * to it: nothing is hidden that was previously visible, so the gate is decided
 * by what the CARD'S SOURCE does to a caller who may not see its rows. The two
 * cards added together answer that differently, and neither is the default:
 *
 * - `core/upcoming-releases` is gated. `ReleasesService.find` authorizes by
 *   THROWING, so an ungranted reader gets a card stuck in its error state
 *   rather than an empty one -- see its own note.
 * - `core/recent-activity` is not. Its feed takes the caller's readable
 *   collections as a scope and defaults that scope to NOTHING, so a reader
 *   entitled to none of it is shown an empty feed. That is a card correctly
 *   saying there is nothing to report, which needs no gate; a gate would
 *   instead hide the feed from anyone whose permissions happened to be narrow
 *   today.
 *
 * @module domains/widgets/core-widgets
 */

import type { WidgetDefinition } from "../definition";

import { breakdownWidget } from "./breakdown";
import { contentWidget } from "./content";
import { countWidget } from "./count";
import { getStartedWidget } from "./get-started";
import { needsAttentionWidget } from "./needs-attention";
import { noteWidget } from "./note";
import { overTimeWidget } from "./over-time";
import { quickCreateWidget } from "./quick-create";
import { recentActivityWidget } from "./recent-activity";
import { recentEntriesWidget } from "./recent-entries";
import { recentlyEditedWidget } from "./recently-edited";
import { teamWidget } from "./team";
import { upcomingReleasesWidget } from "./upcoming-releases";

/**
 * Core's widgets declared with `defineWidget`, as a plugin declares its own.
 * Registered through the same call as everyone's declarations, under core.
 */
export const CORE_DECLARATIONS = [noteWidget] as const;

/** Core's widgets still written as definitions: every one not declared. */
const CORE_WIDGET_LITERALS = [
  getStartedWidget,
  contentWidget,
  quickCreateWidget,
  teamWidget,
  needsAttentionWidget,
  recentlyEditedWidget,
  upcomingReleasesWidget,
  recentActivityWidget,
  countWidget,
  breakdownWidget,
  recentEntriesWidget,
  overTimeWidget,
] as const satisfies readonly WidgetDefinition[];

/**
 * Core's widgets still written as definitions, as every reader of a
 * definition sees them.
 *
 * The same array as `CORE_WIDGET_LITERALS`, typed as definitions: callers
 * read optional fields (`requiredPermission`, `chrome`, `lifecycle`) that a
 * literal type would only have on the entries that set them. NOT every core
 * widget: read core's ids from `CORE_WIDGET_IDS`.
 */
export const CORE_WIDGETS: readonly WidgetDefinition[] = CORE_WIDGET_LITERALS;

// Core's widget ids, and their order, live in `./ids`, which imports nothing:
// re-exported for the readers that load the widgets anyway.
export { CORE_WIDGET_IDS } from "./ids";

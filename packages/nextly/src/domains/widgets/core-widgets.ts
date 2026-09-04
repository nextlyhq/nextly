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
 * All four are `custom` with `chrome: "none"`. Each already draws a titled
 * section with its own rules, loading skeleton and error state; framed by
 * `WidgetCard` each would gain a second heading above its own. `title` is still
 * required and still meaningful -- it is what names the card in the layout
 * editor, where a reader chooses what to show.
 *
 * Deliberately NO `requiredPermission`. Every one of these is visible to any
 * authenticated admin today, and adding a gate here would hide a card someone
 * currently sees -- a behaviour change wearing the costume of a refactor. The
 * gate that belongs on `core/team` in particular waits on a question this
 * repository has not answered: which permission gates a bare COUNT of users,
 * given `dashboard-service` computes it unscoped.
 *
 * @module domains/widgets/core-widgets
 */

import type { WidgetDefinition } from "./definition";
import { VERSIONS_SOURCE_ID } from "./system-source-ids";

/**
 * The prefix core's dashboard components resolve under.
 *
 * Reserved by the admin's component registry, which refuses both registration
 * and unregistration under it by anything but core -- otherwise a plugin could
 * replace the body drawn for a card the registry still attributes to core.
 */
export const CORE_WIDGET_COMPONENT_PREFIX = "core#";

/**
 * Ordered as the dashboard has always drawn them.
 *
 * Spaced by ten rather than numbered one-by-one, so a card can be placed
 * between two of these later without renumbering the rest -- the reason
 * `defaultOrder` is a number and not an index.
 */
export const CORE_WIDGETS: readonly WidgetDefinition[] = [
  {
    id: "core/seed-demo-content",
    title: "Get started",
    description:
      "Offers to seed demo content, and hides itself once that is done or declined.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    defaultOrder: 0,
    component: "core#SeedDemoContentCard",
  },
  {
    id: "core/collections",
    title: "Collections",
    description: "Entry counts per collection, grouped by what provides them.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    defaultOrder: 10,
    component: "core#CollectionQuickLinks",
  },
  {
    id: "core/singles",
    title: "Singles",
    description: "The project's singles, or nothing when it has none.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    defaultOrder: 20,
    component: "core#SinglesQuickLinks",
  },
  {
    id: "core/quick-create",
    title: "Create",
    description:
      "One click to an empty entry form, for the collections this reader may create in.",
    archetype: "custom",
    defaultSize: "full",
    defaultOrder: 15,
    component: "core#QuickCreate",
  },
  {
    id: "core/team",
    title: "Team",
    description: "How many users and roles the project has.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    defaultOrder: 30,
    component: "core#TeamSummary",
  },
  {
    id: "core/pending-edits",
    title: "Unpublished changes",
    description: "Documents holding edits that are not live yet",
    archetype: "metric",
    defaultSize: "sm",
    defaultOrder: 25,
    query: { source: VERSIONS_SOURCE_ID, op: "count" },
  },
  {
    id: "core/recently-edited",
    title: "Recently edited",
    description:
      "The documents most recently left with unpublished edits, newest first.",
    archetype: "list",
    defaultSize: "md",
    defaultOrder: 35,
    query: {
      source: VERSIONS_SOURCE_ID,
      op: "list",
      select: ["scopeSlug", "entryId", "updatedAt"],
      limit: 5,
    },
  },
] as const;

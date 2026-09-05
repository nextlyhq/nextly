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
 * The `custom` ones carry `chrome: "none"`. Each already draws a titled section
 * with its own rules, loading skeleton and error state; framed by `WidgetCard`
 * each would gain a second heading above its own. `title` is still required and
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
 * grid. Every one of those is visible to any authenticated admin today, and
 * adding a gate would hide a card someone currently sees -- a behaviour change
 * wearing the costume of a refactor. The gate that belongs on `core/team` in
 * particular waits on a question this repository has not answered: which
 * permission gates a bare COUNT of users, given `dashboard-service` computes it
 * unscoped.
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

import type { WidgetDefinition } from "./definition";
import { RELEASES_SOURCE_ID, VERSIONS_SOURCE_ID } from "./system-source-ids";

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
    /*
     * Two fields, because the `list` archetype draws the first two and silently
     * drops the rest -- see `core/upcoming-releases`. This card selected three,
     * so `updatedAt` was never drawn on a card whose own description promises
     * "most recently ... newest first".
     *
     * 🔴 `entryId` is KEPT and `scopeSlug` is the one dropped, and the first
     * attempt at this had it the other way round. Dropping the id looked right
     * -- it is a uuid, and the collection name reads better -- but two pending
     * edits in the same collection then render as the same two values, so a
     * card describing a list of DOCUMENTS could not tell one from another. A
     * row that cannot name its subject is worse than one naming it awkwardly.
     *
     * The uuid is still the wrong thing to show a person, and the fix for that
     * is not here: `system:versions` publishes no document title, so there is
     * nothing better to select. Tracked separately -- the source needs a title
     * field before this card can read the way it should.
     */
    query: {
      source: VERSIONS_SOURCE_ID,
      op: "list",
      select: ["entryId", "updatedAt"],
      limit: 5,
    },
  },
  {
    id: "core/upcoming-releases",
    title: "Upcoming releases",
    description: "Scheduled releases that have not shipped yet, soonest first.",
    archetype: "list",
    defaultSize: "md",
    defaultOrder: 40,
    /*
     * 🔴 The ONLY core card with a gate, and the asymmetry is deliberate rather
     * than an inconsistency. `ReleasesService.find` opens with
     * `authorize(actor, "read")`, which THROWS -- so an ungranted reader does
     * not get an empty card, they get one stuck in its error state, reporting a
     * failure that is really a permission they were never meant to have. The
     * two outcomes a card can have here are "hidden" and "broken", and nothing
     * in between is reachable.
     *
     * `partitionPlacements` drops a card whose `requiredPermission` this caller
     * lacks before the query is ever batched, and keeps it in the stored ROW so
     * a reader whose grant is later widened gets it back where it was.
     *
     * 🔴 THREE slugs, any of which opens it, because `authorize` does not treat
     * read as the only way to read: it returns early when the caller holds
     * `create` or `publish`, deliberately, so a role granted only `create` can
     * see the release it just made. The admin's `canViewReleases` capability
     * lists the same three. Gating on the read slug alone made this card a
     * third encoding of one rule and the only one that disagreed -- a
     * create-only editor could open the releases screen and never see its card.
     *
     * Each slug is `${action}-${resource}` and `parsePermissionSlug` splits on
     * the FIRST hyphen, so these parse to read/create/publish over
     * `content-releases` -- matching `RELEASES_RESOURCE` and the authorities
     * `api/releases.ts` requires of a human. Written out rather than composed
     * from the constants because importing them would pull the releases
     * service's wiring into this list, the same coupling `system-source-ids.ts`
     * exists to avoid; a test parses them back and compares.
     */
    requiredPermission: [
      "read-content-releases",
      "create-content-releases",
      "publish-content-releases",
    ],
    /*
     * 🔴 TWO fields, and `state` is deliberately not one of them. The `list`
     * archetype destructures `const [labelField, detailField] = select` and
     * draws nothing past the second, so a third entry is not extra detail --
     * it is silently dropped. Selecting title, state, scheduledAt therefore
     * rendered each release beside the word "scheduled" and never showed WHEN,
     * on a card whose entire subject is when.
     *
     * `state` would carry no information even if it were drawn: `resolveReleases`
     * queries `state: "scheduled"` unconditionally, so every row this source can
     * return already has it. The invariant field is the one to drop.
     */
    query: {
      source: RELEASES_SOURCE_ID,
      op: "list",
      select: ["title", "scheduledAt"],
      limit: 5,
    },
  },
  {
    id: "core/recent-activity",
    title: "Recent activity",
    description: "Who changed what, most recent first.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    defaultOrder: 45,
    component: "core#RecentActivity",
  },
] as const;

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

import {
  CONTENT_WIDTHS,
  CREATE_WIDTHS,
  NEEDS_ATTENTION_WIDTHS,
  RECENT_ACTIVITY_WIDTHS,
  RECENTLY_EDITED_WIDTHS,
  TEAM_WIDTHS,
  UPCOMING_RELEASES_WIDTHS,
} from "./core-widget-widths";
import { settings } from "./declaration/setting-builders";
import type { WidgetDefinition, WidgetSetting } from "./definition";
import { MAX_WIDGET_LIMIT } from "./query-limits";
import type { AnyWidgetSetting } from "./settings";
import {
  ACTIVITY_SOURCE_ID,
  ATTENTION_SOURCE_ID,
  CONTENT_SOURCE_ID,
  RECENT_EDITS_SOURCE_ID,
  RELEASES_SOURCE_ID,
  TEAM_SOURCE_ID,
} from "./system-source-ids";
import { TEAM_GATE } from "./team-gate";

/**
 * Recent activity's "Number of items": the one offer every card makes, from the
 * builder, named `limit` so it sets the card's query.
 *
 * Held as the public `WidgetSetting` rather than written into the list: the
 * builder's own type carries a value brand only declarations read, which the
 * published list of core's widgets has no name for.
 */
const RECENT_ACTIVITY_ITEMS: WidgetSetting = {
  name: "limit",
  label: "Number of items",
  ...settings.items(),
};

/** Recently edited's "Number of items", the same offer under the same name. */
const RECENTLY_EDITED_ITEMS: WidgetSetting = RECENT_ACTIVITY_ITEMS;

/**
 * Recently edited's "Only mine": the reader's own saves alone. Its source
 * narrows by it (`onlyMine` among its filters), so the knob sets the query's
 * `where` rather than the card's source.
 */
const RECENTLY_EDITED_ONLY_MINE: WidgetSetting = {
  name: "onlyMine",
  label: "Only mine",
  ...settings.onlyMine(),
};

/**
 * Recently edited's "Collection": one collection's saves, or every collection
 * the reader may read when none is chosen, which is the default. Its source
 * reads across collections and narrows by one, so the knob sets the query's
 * `where` and the card keeps its source.
 */
const RECENTLY_EDITED_COLLECTION: AnyWidgetSetting = {
  name: "collection",
  label: "Collection",
  ...settings.collection(),
};

/**
 * The prefix core's dashboard components resolve under.
 *
 * Reserved by the admin's component registry, which refuses both registration
 * and unregistration under it by anything but core -- otherwise a plugin could
 * replace the body drawn for a card the registry still attributes to core.
 */
export const CORE_WIDGET_COMPONENT_PREFIX = "core#";

/**
 * The agreed default dashboard, in `defaultOrder`: Needs attention, Create,
 * Recently edited, Recent activity, Content, Upcoming releases and Team, each
 * at its agreed width (`core-widget-widths.ts`), after the onboarding cards.
 *
 * Spaced by ten rather than numbered one-by-one, so a card can be placed
 * between two of these later without renumbering the rest -- the reason
 * `defaultOrder` is a number and not an index.
 */
const CORE_WIDGET_LITERALS = [
  {
    id: "core/seed-demo-content",
    title: "Get started",
    description:
      "Offers to seed demo content while there is nothing to look at yet.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    // The narrowest width it still draws at: its offer is laid out across the row.
    minSize: "full",
    defaultOrder: 0,
    component: "core#SeedDemoContentCard",
    /*
     * Transient, and declared as such. The card used to hide ITSELF once
     * seeding was done or declined -- it was placed in the grid, given an
     * order, and then rendered nothing -- so the arrangement reserved a slot
     * for a card drawing nothing and the reason lived in a component.
     *
     * 🔴 TWO conditions, and the pair is the point. This card asks something
     * neither one answers alone: is there nothing to look at, AND is the offer
     * of demo content still open. `content:empty` alone left a reader who
     * DECLINED still holding the slot, because declining does not create
     * content. Folding the decline into `content:empty` was refused instead:
     * conditions are evaluated once per NAME and shared by every widget asking,
     * so a plugin's card declaring `content:empty` would have vanished because
     * someone dismissed a core offer.
     *
     * The two are scoped differently on purpose. `content:empty` is about this
     * READER; `seed:unanswered` is about the INSTALL, since whether a project
     * took the demo data is recorded once and a second admin should not be
     * offered it again after the first declined.
     */
    lifecycle: "conditional",
    visibleWhen: ["content:empty", "seed:unanswered"],
  },
  {
    id: "core/onboarding-checklist",
    title: "Set up your project",
    description:
      "The setup steps still outstanding, detected from the install rather than ticked by hand.",
    archetype: "custom",
    chrome: "none",
    defaultSize: "full",
    // The narrowest width it still draws at: its steps are laid out across the row.
    minSize: "full",
    // Between the seed offer and the first content card. Both are transient and
    // both address a reader who has just arrived, so they sit together rather
    // than with the cards that stay.
    defaultOrder: 5,
    component: "core#OnboardingChecklist",
    /*
     * Offered only while there is something left to do, and dropped by the host
     * the moment there is not. The card used to decide that for itself from
     * `localStorage`, which made it a per-BROWSER answer to a per-reader
     * question: the same person on a second machine met a checklist they had
     * already finished, and a colleague met one reporting someone else's
     * progress.
     */
    lifecycle: "conditional",
    visibleWhen: "onboarding:incomplete",
    // 🔴 Both, and they answer different questions. The condition takes the card
    // away when the INSTALL says the work is done; this takes it away when the
    // READER says they do not want it. Without the second, somebody who has no
    // intention of finishing the checklist has to finish it to be rid of it.
    dismissible: true,
  },
  {
    id: "core/content",
    title: "Content",
    description:
      "Each collection and Single this reader may see, with its entries and drafts.",
    archetype: "custom",
    defaultSize: "full",
    // From half the row, where its list of collections and Singles still reads, to the full width.
    ...CONTENT_WIDTHS,
    defaultOrder: 50,
    component: "core#CollectionQuickLinks",
    // Each collection's entries and drafts, and each Single, counted as the reader, in the batch
    // like every card. Asked the most any widget query may return: an omitted limit is the
    // default 5, and this card lists everything, saying "more exist" past the last it draws.
    query: { source: CONTENT_SOURCE_ID, op: "list", limit: MAX_WIDGET_LIMIT },
    /*
     * Offered only while this reader has a collection or a Single to see that
     * is neither internal nor hidden. A reader with nothing to list is not
     * shown an empty list. It replaces the Collections and Singles cards, whose
     * saved cards convert into it (`RETIRED_WIDGETS`).
     */
    lifecycle: "conditional",
    visibleWhen: "content:present",
  },
  {
    id: "core/quick-create",
    title: "Create",
    description:
      "One click to an empty entry form, for the collections this reader may create in.",
    archetype: "custom",
    defaultSize: "md",
    // From a third, where its row of create buttons wraps, to the full width.
    ...CREATE_WIDTHS,
    defaultOrder: 20,
    component: "core#QuickCreate",
    // Offered only to a reader who could create an entry somewhere: every
    // button on it would otherwise open onto a refusal.
    lifecycle: "conditional",
    visibleWhen: "create:available",
  },
  {
    id: "core/team",
    title: "Team",
    // Tier-neutral: a small card draws the people alone, and a reader may see only one count.
    description: "Your project's team at a glance.",
    archetype: "custom",
    defaultSize: "md",
    // From a quarter, where its small tier draws the people alone, to half the row.
    ...TEAM_WIDTHS,
    defaultOrder: 70,
    component: "core#TeamSummary",
    link: { label: "All users", href: "/admin/users" },
    // Offered to the readers its source answers, by the one constant both read.
    requiredPermission: TEAM_GATE,
    query: { source: TEAM_SOURCE_ID, op: "list" },
  },
  {
    id: "core/needs-attention",
    title: "Needs attention",
    description:
      "What is waiting: unpublished changes, releases due this week, and overdue releases.",
    archetype: "custom",
    // Two thirds by default; from a third, where its small tier still names
    // each kind, to the full width, where each kind breaks down per collection.
    defaultSize: "xl",
    ...NEEDS_ATTENTION_WIDTHS,
    defaultOrder: 10,
    // Offered only to a reader who may read a kind it counts; its source
    // answers "not available" to anyone else.
    lifecycle: "conditional",
    visibleWhen: "attention:readable",
    // Ungated: each kind is answered by its own domain as the reader, and a
    // kind they may not read is simply absent from the answer.
    // As many kinds and parts as a grouped answer may carry: the card draws
    // each part at its widest, and the source caps the answer at this.
    query: {
      source: ATTENTION_SOURCE_ID,
      op: "groupBy",
      groupBy: "item",
      limit: MAX_WIDGET_LIMIT,
    },
    component: "core#NeedsAttention",
  },
  {
    id: "core/recently-edited",
    title: "Recently edited",
    description:
      "The entries and Singles most recently saved, newest first, one row each.",
    archetype: "list",
    defaultSize: "lg",
    // Half the row by default; from a third, where its rows still read, to the full width.
    ...RECENTLY_EDITED_WIDTHS,
    defaultOrder: 30,
    // From the activity trail, one row per document at its latest save the
    // reader may see, across every collection they may read; the same trail
    // Recent activity reads, grouped by document rather than by run. The title
    // and when it was saved, the two fields a list draws.
    query: {
      source: RECENT_EDITS_SOURCE_ID,
      op: "list",
      select: ["entryTitle", "createdAt"],
      limit: 5,
    },
    settings: [
      RECENTLY_EDITED_ONLY_MINE,
      RECENTLY_EDITED_COLLECTION,
      RECENTLY_EDITED_ITEMS,
    ],
  },
  {
    id: "core/upcoming-releases",
    title: "Upcoming releases",
    description: "Scheduled releases that have not shipped yet, soonest first.",
    // Its own component, so the line naming releases that need attention can sit above the
    // rows; the rows themselves are drawn as core's list cards draw them.
    archetype: "custom",
    component: "core#UpcomingReleases",
    link: { label: "All releases", href: "/admin/releases" },
    defaultSize: "md",
    // From a third, where its rows still read, to two thirds: a short list needs no more.
    ...UPCOMING_RELEASES_WIDTHS,
    defaultOrder: 60,
    // Beside its gate: offered once a release exists that the reader may
    // read, not as an empty card on a site that has never made one.
    lifecycle: "conditional",
    visibleWhen: "releases:present",
    /*
     * 🔴 One of the two core cards with a gate, and the asymmetry is deliberate rather
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
      // Selecting `reason` is what asks the source for the attention rows; see `system:releases`.
      select: ["kind", "title", "scheduledAt", "reason", "count"],
      limit: 5,
    },
    // Asked like core's lists: the rows its size draws and one more, for "more exist".
    sizedQuery: true,
  },
  {
    id: "core/recent-activity",
    title: "Recent activity",
    description: "Who changed what, most recent first.",
    // Its own component, because a row is a sentence with an avatar, a badge and
    // a time read relative to now, which no list line draws. Framed, so the
    // heading, the size tiers and the empty state are the card's like any
    // other's, and answered by `system:activity` through the batch, the same
    // read the activity endpoint makes.
    archetype: "custom",
    defaultSize: "lg",
    // Half the row by default; from a third, where its rows still read, to the full width.
    ...RECENT_ACTIVITY_WIDTHS,
    defaultOrder: 40,
    component: "core#RecentActivity",
    query: { source: ACTIVITY_SOURCE_ID, op: "list" },
    // Asked like core's own lists: the rows its size draws and one more, so the
    // card can say more exist at every size.
    sizedQuery: true,
    settings: [RECENT_ACTIVITY_ITEMS],
  },
] as const satisfies readonly WidgetDefinition[];

/**
 * Core's widgets, as every reader of a definition sees them.
 *
 * The same array as `CORE_WIDGET_LITERALS`, typed as definitions: callers
 * read optional fields (`requiredPermission`, `chrome`, `lifecycle`) that a
 * literal type would only have on the entries that set them.
 */
export const CORE_WIDGETS: readonly WidgetDefinition[] = CORE_WIDGET_LITERALS;

/**
 * The id of one of core's widgets.
 *
 * Read from the list itself, kept literal by `as const` above, so a widget
 * added, renamed or removed there changes this with no second edit: a plugin
 * offering an alternative to a built-in is checked against the widgets core
 * actually has.
 */
export type CoreWidgetId = (typeof CORE_WIDGET_LITERALS)[number]["id"];

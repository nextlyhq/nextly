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

import { IN_RELEASE_KEY } from "../collections/query/reserved-filter-keys";

import { settings } from "./declaration/setting-builders";
import type { WidgetDefinition, WidgetSetting } from "./definition";
import { GET_STARTED_WIDGET_ID } from "./get-started-steps";
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

/**
 * The most a note holds, in characters (code points). A note is the reader's
 * own text in their layout row, which is bounded as a whole
 * (`MAX_LAYOUT_BYTES`), so one note cannot take the whole of it.
 */
const NOTE_MAX_LENGTH = 2000;

/** A note's text: Markdown over several lines, empty until its reader writes it. */
const NOTE_TEXT: WidgetSetting = {
  name: "text",
  label: "Note",
  ...settings.textarea({ default: "", maxLength: NOTE_MAX_LENGTH }),
};

/** Recent entries' "Number of items", the same offer under the same name. */
const RECENT_ENTRIES_ITEMS: WidgetSetting = RECENT_ACTIVITY_ITEMS;

/**
 * Over time's Date range, its one quick setting: the range its chart draws,
 * which becomes its query's `range`.
 */
const OVER_TIME_DATE_RANGE: WidgetSetting = {
  name: "dateRange",
  label: "Date range",
  type: "select",
  defaultValue: "30d",
  quick: true,
  // Named for the reader, as the card's header shows them; each value is a
  // range the query draws (`TIMESERIES_RANGES`).
  options: [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Last 90 days", value: "90d" },
    { label: "Last 12 months", value: "12m" },
  ],
};

/** Over time's Chart style: a line, or one bar per interval. */
const OVER_TIME_CHART_STYLE: WidgetSetting = {
  name: "chartStyle",
  label: "Chart style",
  type: "select",
  defaultValue: "line",
  options: [
    { label: "Line", value: "line" },
    { label: "Bars", value: "bars" },
  ],
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
 * at its agreed size, after the onboarding cards. The cards that share a row
 * share a height, so the default dashboard tiles: Needs attention and Create
 * at 3 rows, the two activity lists at 4, Upcoming releases and Team at 4.
 *
 * Spaced by ten rather than numbered one-by-one, so a card can be placed
 * between two of these later without renumbering the rest -- the reason
 * `defaultOrder` is a number and not an index.
 */
const CORE_WIDGET_LITERALS = [
  {
    id: GET_STARTED_WIDGET_ID,
    title: "Get started",
    description:
      "The setup steps this reader could still take, detected from the install rather than ticked by hand.",
    archetype: "custom",
    // Full width only, and tall enough for every step it shows by default: a card never scrolls,
    // so a shorter one cut its last steps off. Measured in the browser, the steps it draws before
    // "Show N more" (a collection, an entry, five Singles and an invite, about 580 px with that
    // control) fit the body of eight rows. Taller for a site that opens the rest of its Singles,
    // never shorter. The end-to-end grid spec checks that the steps fit.
    size: {
      default: { w: 12, h: 8 },
      min: { w: 12, h: 8 },
      max: { w: 12, h: 12 },
    },
    // First: it addresses a reader who has just arrived.
    defaultOrder: 0,
    component: "core#GetStartedCard",
    /*
     * 🔴 No condition. Whether a widget is visible is part of the token a
     * layout write is checked against, so a card whose visibility followed its
     * steps would turn a reader's skip or dismissal into a stale-scope refusal
     * whenever a step changed between their read and their write, and a card
     * in their row would vanish from view and from Removed. Visible by
     * permission alone, it is drawn or left dormant by the layout read, from
     * the step answer and the card's own settings, after the stored row is
     * read (see `api/widget-layout.ts`).
     *
     * It replaces "Set up your project" and the sample-content offer.
     */
    dismissible: true,
  },
  {
    id: "core/content",
    title: "Content",
    description:
      "Each collection and Single this reader may see, with its entries and drafts.",
    archetype: "custom",
    // From half the row, where its list of collections and Singles still reads, to the full width.
    size: {
      default: { w: 12, h: 4 },
      min: { w: 6, h: 3 },
      max: { w: 12, h: 6 },
    },
    defaultOrder: 50,
    component: "core#CollectionQuickLinks",
    // Each collection's entries and drafts, and each Single, counted as the reader, in the batch
    // like every card. Asked the most any widget query may return: an omitted limit is the
    // default 5, and this card lists everything, saying "more exist" past the last it draws.
    query: { source: CONTENT_SOURCE_ID, op: "list", limit: MAX_WIDGET_LIMIT },
    /*
     * Offered only while this reader has a collection or a Single to see that
     * is neither internal nor hidden. A reader with nothing to list is not
     * shown an empty list. It replaces the Collections and Singles cards.
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
    // From a third, where its row of create buttons wraps, to the full width.
    size: {
      default: { w: 4, h: 3 },
      min: { w: 4, h: 2 },
      max: { w: 12, h: 4 },
    },
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
    // From a quarter, where its small tier draws the people alone, to half the row.
    size: {
      default: { w: 4, h: 4 },
      min: { w: 3, h: 2 },
      max: { w: 6, h: 4 },
    },
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
    size: {
      default: { w: 8, h: 3 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 6 },
    },
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
    // Its own component, because a row is a link to its document and a line of
    // what the list draws no room for: its collection, who saved it, when, and
    // its status. Framed, so the heading, the size tiers and the empty state are
    // the card's like any other's.
    archetype: "custom",
    component: "core#RecentlyEdited",
    // Half the row by default; from a third, where its rows still read, to the full width.
    size: {
      default: { w: 6, h: 4 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 6 },
    },
    defaultOrder: 30,
    // From the activity trail, one row per document at its latest save the
    // reader may see, across every collection they may read; the same trail
    // Recent activity reads, grouped by document rather than by run. Every
    // field a row is drawn from, and nothing the card does not draw.
    query: {
      source: RECENT_EDITS_SOURCE_ID,
      op: "list",
      select: [
        "id",
        "entryId",
        "entryTitle",
        "collection",
        "subjectKind",
        "locale",
        "actorType",
        "userId",
        "userName",
        "identityErasedAt",
        "createdAt",
        "status",
        "pendingChanges",
      ],
      limit: 5,
    },
    // Asked like core's own lists: the rows its size draws and one more, so the
    // card can say more exist at every size.
    sizedQuery: true,
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
    // From a third, where its rows still read, to two thirds: a short list needs no more.
    size: {
      default: { w: 4, h: 4 },
      min: { w: 4, h: 3 },
      max: { w: 8, h: 6 },
    },
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
    // Half the row by default; from a third, where its rows still read, to the full width.
    size: {
      default: { w: 6, h: 4 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 6 },
    },
    defaultOrder: 40,
    component: "core#RecentActivity",
    query: { source: ACTIVITY_SOURCE_ID, op: "list" },
    // Asked like core's own lists: the rows its size draws and one more, so the
    // card can say more exist at every size.
    sizedQuery: true,
    settings: [RECENT_ACTIVITY_ITEMS],
  },
  {
    id: "core/count",
    title: "Count",
    description:
      "How many entries a collection holds, published and draft, and how that is changing.",
    archetype: "custom",
    component: "core#Count",
    // Added from a collection's group of the add panel, once per collection,
    // and never placed on the default dashboard.
    offered: "per-collection",
    // A figure, a quarter wide by default; up to two thirds, where the trend
    // is drawn, and a row taller to give it room.
    size: { default: { w: 3, h: 2 }, max: { w: 8, h: 3 } },
    settings: [
      { name: "collection", type: "collection", label: "Collection" },
      { name: "filter", type: "filter", of: "collection", label: "Filter" },
    ],
    // Each read on its own path. The number is ONE read either way: the status
    // split for a collection with a lifecycle (the total is its buckets'
    // sum), a plain count for one without.
    cells: [
      {
        key: "split",
        when: "lifecycle",
        query: { op: "groupBy", groupBy: "status", status: "all" },
      },
      {
        key: "total",
        when: "no-lifecycle",
        query: { op: "count", status: "all" },
      },
      {
        // The trend and the change against the 30 days before are drawn by a
        // large card alone, so a narrower one does not ask them.
        key: "trend",
        drawnFrom: "large",
        query: {
          op: "timeseries",
          dateField: "createdAt",
          interval: "day",
          status: "all",
          limit: 30,
          since: "30d",
        },
      },
      {
        key: "prior",
        drawnFrom: "large",
        query: { op: "count", status: "all", since: "60d", until: "30d" },
      },
      {
        // The entries a scheduled release will publish, through the entry
        // list's own condition, so the figure and the list it links to are
        // one read. A caller with no release to read is answered "not
        // available", and the card leaves the figure out.
        key: "scheduled",
        when: "lifecycle",
        // Beside the split, which a small card leaves out.
        drawnFrom: "medium",
        query: {
          op: "count",
          status: "all",
          where: { [IN_RELEASE_KEY]: true },
        },
      },
    ],
  },
  {
    id: "core/breakdown",
    title: "Breakdown",
    description:
      "How a collection's entries divide: by status, or by a field with choices.",
    archetype: "bars",
    // Added from a collection's group of the add panel, once per collection
    // and again with other settings, never placed on the default dashboard.
    // Offered only on a collection with something to divide its entries by.
    offered: "per-collection",
    // A third by default; from a quarter to half the row.
    size: {
      default: { w: 4, h: 3 },
      min: { w: 3, h: 3 },
      max: { w: 6, h: 4 },
    },
    settings: [
      { name: "collection", type: "collection", label: "Collection" },
      { name: "filter", type: "filter", of: "collection", label: "Filter" },
      // No static default: collections need not share a field. Unset, or set
      // to a field this reader may not use, it groups by what the collection
      // divides by (status, else its first groupable choice field).
      {
        name: "groupBy",
        type: "groupBy",
        of: "collection",
        label: "Group by",
        defaultFrom: "collection",
      },
    ],
    // Its source and its group key are the card's settings: a Breakdown set
    // to no collection, or to one with nothing to divide by, asks nothing.
    query: { op: "groupBy", status: "all" },
  },
  {
    id: "core/note",
    title: "Note",
    description: "A note of your own, in Markdown, that only you see.",
    // Its own component: the reader's Markdown, drawn read-only through the
    // text archetype's renderer, from the card's own setting.
    archetype: "custom",
    component: "core#Note",
    // Added from the add panel when a reader wants one, never placed on the
    // default dashboard, where it would be an empty card; several allowed.
    offered: "on-request",
    // Any width from a quarter, and as tall as its reader's text wants.
    size: {
      default: { w: 4, h: 3 },
      min: { w: 3, h: 2 },
      max: { w: 12, h: 6 },
    },
    settings: [NOTE_TEXT],
  },
  {
    id: "core/recent-entries",
    title: "Recent entries",
    description:
      "A collection's entries changed most recently, each linking to its entry.",
    archetype: "custom",
    component: "core#RecentEntries",
    // Added from a collection's group of the add panel, once per collection or
    // more, and never placed on the default dashboard.
    offered: "per-collection",
    // Half the row by default; from a third, where its rows still read, to the full width.
    size: {
      default: { w: 6, h: 4 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 6 },
    },
    // Asked like core's own lists: the rows its size draws and one more, so the
    // card can say more exist at every size.
    sizedQuery: true,
    settings: [
      // Titled: each row is asked by the collection's own title field, its
      // status where it has a lifecycle, and when it was updated.
      {
        name: "collection",
        type: "collection",
        label: "Collection",
        rows: "titled",
      },
      { name: "filter", type: "filter", of: "collection", label: "Filter" },
      {
        name: "sort",
        type: "sort",
        of: "collection",
        label: "Sort",
        defaultValue: "-updatedAt",
      },
      RECENT_ENTRIES_ITEMS,
    ],
    query: { op: "list", status: "all", sort: "-updatedAt", limit: 5 },
  },
  {
    id: "core/over-time",
    title: "Over time",
    description:
      "How many entries a collection gained in each day, week or month of a range.",
    archetype: "custom",
    component: "core#OverTime",
    offered: "per-collection",
    // Half the row by default; from a third, where its chart still reads, to the full width.
    size: {
      default: { w: 6, h: 3 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 4 },
    },
    settings: [
      { name: "collection", type: "collection", label: "Collection" },
      { name: "filter", type: "filter", of: "collection", label: "Filter" },
      // The card's one quick setting: its range, on the card's header.
      OVER_TIME_DATE_RANGE,
      OVER_TIME_CHART_STYLE,
    ],
    // Entries created: `createdAt`, every interval the range overlaps, the
    // first one counting only what falls inside the range.
    query: {
      op: "timeseries",
      status: "all",
      dateField: "createdAt",
      range: "30d",
    },
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

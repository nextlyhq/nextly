/**
 * Where the add panel lists each widget, and in what order.
 *
 * Core assigns the group; a widget never declares it. Five fixed groups keep
 * the panel predictable, and keep a plugin's widgets together where its author
 * and its users expect them; a free-text category as a group would let any
 * plugin add groups or slip into Overview. A declared category is carried as a
 * label to search instead.
 *
 * The fifth group, "Removed from your dashboard", is not here: it is the
 * reader's own removed cards, which the arrangement already names, and a card
 * listed there keeps the group it would otherwise have.
 *
 * Every widget the install has is offered somewhere: each is declared, by
 * core, a plugin or the site, and a card about one collection is a Content
 * widget set to it rather than a widget of its own.
 *
 * @module domains/widgets/add-panel
 */

import type { CanonicalWidget } from "./canonical";
import {
  CORE_WIDGET_ID,
  CORE_WIDGET_IDS,
  type CoreWidgetId,
} from "./core-widgets/ids";

/** The groups a widget can be listed in, in the panel's order. */
export const ADD_PANEL_GROUPS = [
  "overview",
  "content",
  "team",
  "plugins",
] as const;

export type AddPanelGroup = (typeof ADD_PANEL_GROUPS)[number];

/**
 * Each built-in's group. Keyed by every core id, so a built-in added to core
 * without a group here does not compile.
 */
const CORE_GROUPS = {
  [CORE_WIDGET_ID.setup]: "overview",
  [CORE_WIDGET_ID.contentTable]: "overview",
  [CORE_WIDGET_ID.quickCreate]: "overview",
  [CORE_WIDGET_ID.team]: "team",
  [CORE_WIDGET_ID.needsAttention]: "overview",
  [CORE_WIDGET_ID.continue]: "overview",
  [CORE_WIDGET_ID.upcomingReleases]: "overview",
  [CORE_WIDGET_ID.teamActivity]: "team",
  [CORE_WIDGET_ID.count]: "content",
  [CORE_WIDGET_ID.breakdown]: "content",
  [CORE_WIDGET_ID.note]: "overview",
  [CORE_WIDGET_ID.recentEntries]: "content",
  [CORE_WIDGET_ID.overTime]: "content",
  [CORE_WIDGET_ID.systemHealth]: "overview",
} as const satisfies Record<CoreWidgetId, AddPanelGroup>;

/** A built-in's place in core's own order, for Overview's first rows. */
// Keyed by any widget id: the panel asks it of every widget, core's or not.
const CORE_ORDER = new Map<string, number>(
  CORE_WIDGET_IDS.map((id, index) => [id, index])
);

/** What the add panel shows about a widget beside its name. */
export interface AddPanelFacts {
  group: AddPanelGroup;
  /** The collection a Content card reads, or the plugin a Plugins one comes from. */
  subgroup?: string;
  description?: string;
  /** The widget's declared category: searched, and shown as a label. */
  category?: string;
  /** Which sketch draws its row: the widget's archetype. */
  sketch: string;
  /**
   * Listed once per collection the reader may read, each row adding a card
   * set to that collection. @experimental
   */
  perCollection?: true;
}

function isCoreWidgetId(id: string): id is CoreWidgetId {
  return Object.prototype.hasOwnProperty.call(CORE_GROUPS, id);
}

/** The group and sub-group, before the labels are added. */
function placeOf(
  widget: CanonicalWidget
): Pick<AddPanelFacts, "group" | "subgroup"> {
  // A plugin's widget first: a plugin that overrides a built-in's id is still
  // the plugin's, and is found under it.
  if (widget.plugin !== undefined) {
    return { group: "plugins", subgroup: widget.plugin };
  }
  // Offered inside each collection's part of the Content group: the admin
  // lists it once per collection the reader may read, from the collections it
  // already holds, so no collection is named here.
  if (widget.offered === "per-collection") return { group: "content" };
  if (isCoreWidgetId(widget.id)) return { group: CORE_GROUPS[widget.id] };
  // The site's own: beside the built-ins, since it is the site's.
  return { group: "overview" };
}

/** Where the panel lists `widget`, and what it shows beside its name. */
export function addPanelFacts(widget: CanonicalWidget): AddPanelFacts {
  return {
    ...placeOf(widget),
    ...(widget.description === undefined
      ? {}
      : { description: widget.description }),
    ...(widget.category === undefined ? {} : { category: widget.category }),
    sketch: widget.sketch ?? widget.archetype ?? "custom",
    ...(widget.offered === "per-collection" ? { perCollection: true } : {}),
  };
}

/**
 * The sort key within a group, after the group itself.
 *
 * - Overview: the built-ins in core's own order, then the site's widgets in
 *   the order they were declared, so the built-ins sit in one place on every
 *   site and a site's developer orders their own by declaring them.
 * - Content: by sub-group, so a collection's cards sit together.
 * - Plugins: by plugin, in the order the plugins came, each plugin's widgets
 *   in the order it declared them.
 */
function keyOf(
  place: Pick<AddPanelFacts, "group" | "subgroup">,
  widget: CanonicalWidget,
  index: number,
  pluginOrder: ReadonlyMap<string, number>
): [number, string, number] {
  const { group, subgroup } = place;
  const rank = ADD_PANEL_GROUPS.indexOf(group);
  if (group === "plugins") {
    return [
      rank,
      String(pluginOrder.get(subgroup ?? "") ?? 0).padStart(6, "0"),
      index,
    ];
  }
  if (group === "content") return [rank, subgroup ?? "", index];
  const coreIndex = CORE_ORDER.get(widget.id);
  return coreIndex === undefined ? [rank, "1", index] : [rank, "0", coreIndex];
}

/** Each plugin's place among the plugins, in the order their widgets first came. */
function pluginOrderOf(
  widgets: readonly CanonicalWidget[]
): ReadonlyMap<string, number> {
  const pluginOrder = new Map<string, number>();
  for (const widget of widgets) {
    if (widget.plugin !== undefined && !pluginOrder.has(widget.plugin)) {
      pluginOrder.set(widget.plugin, pluginOrder.size);
    }
  }
  return pluginOrder;
}

/** The widgets the panel offers, every one of them, in the order it lists them. */
export function inAddPanelOrder<W extends CanonicalWidget>(
  widgets: readonly W[]
): W[] {
  const pluginOrder = pluginOrderOf(widgets);
  const keyed = widgets.map((widget, index) => ({
    widget,
    key: keyOf(placeOf(widget), widget, index, pluginOrder),
  }));
  keyed.sort(
    (a, b) =>
      a.key[0] - b.key[0] ||
      a.key[1].localeCompare(b.key[1]) ||
      a.key[2] - b.key[2]
  );
  return keyed.map(({ widget }) => widget);
}

// ────────────────────────────────────────────────────────────────────────
// The add gallery (dashboard-experience R-19, R-20): what the reader may add,
// one tile per widget, the collections they may read, and the pairs to
// suggest. The read that asks the database is the gallery route's
// (`api/dashboard-gallery`); everything decided from what it read is here,
// with nothing to read, so each rule is tested on its own.
// ────────────────────────────────────────────────────────────────────────

/** The gallery's filter chips past All, in their order. */
const GALLERY_CATEGORIES = [
  "content",
  "activity",
  "trends",
  "plugins",
] as const;

/** A chip a widget is listed under, past All. */
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

/**
 * Each built-in's chip, in the order the gallery lists them: the add-only
 * widgets first, as the ones a reader comes to add, then the default's cards,
 * which a reader adds back. Keyed by every core id, so a built-in added to
 * core without a chip here does not compile.
 */
const CORE_GALLERY = {
  [CORE_WIDGET_ID.count]: "content",
  [CORE_WIDGET_ID.recentEntries]: "content",
  [CORE_WIDGET_ID.overTime]: "trends",
  [CORE_WIDGET_ID.breakdown]: "trends",
  [CORE_WIDGET_ID.note]: "content",
  [CORE_WIDGET_ID.teamActivity]: "activity",
  [CORE_WIDGET_ID.continue]: "activity",
  [CORE_WIDGET_ID.needsAttention]: "activity",
  [CORE_WIDGET_ID.contentTable]: "content",
  [CORE_WIDGET_ID.quickCreate]: "content",
  [CORE_WIDGET_ID.upcomingReleases]: "activity",
  [CORE_WIDGET_ID.team]: "activity",
  [CORE_WIDGET_ID.setup]: "content",
  [CORE_WIDGET_ID.systemHealth]: "activity",
} as const satisfies Record<CoreWidgetId, GalleryCategory>;

const CORE_GALLERY_ORDER = new Map<string, number>(
  Object.keys(CORE_GALLERY).map((id, index) => [id, index])
);

/**
 * The chip `widget` is listed under: Plugins for a plugin's, whatever it
 * declares; a built-in's from core's table; a site widget's from the
 * `category` it declares, when that names a chip (in any case). Anything else
 * is under All alone: a free-text category is searched, never a chip of its
 * own, so no widget can add a chip.
 */
export function galleryCategoryOf(
  widget: Pick<CanonicalWidget, "id" | "plugin" | "category">
): GalleryCategory | undefined {
  if (widget.plugin !== undefined) return "plugins";
  if (isCoreWidgetId(widget.id)) return CORE_GALLERY[widget.id];
  const declared = widget.category?.trim().toLowerCase();
  return GALLERY_CATEGORIES.find(
    category => category !== "plugins" && category === declared
  );
}

/**
 * The widgets in the gallery's order: core's in its table's order, then the
 * site's as declared, then each plugin's, plugin by plugin in the order they
 * came, each in the order it declared them.
 */
export function inGalleryOrder<W extends CanonicalWidget>(
  widgets: readonly W[]
): W[] {
  const pluginOrder = pluginOrderOf(widgets);
  const keyOfWidget = (widget: W, index: number): [number, number, number] => {
    if (widget.plugin !== undefined) {
      return [2, pluginOrder.get(widget.plugin) ?? 0, index];
    }
    const core = CORE_GALLERY_ORDER.get(widget.id);
    return core === undefined ? [1, 0, index] : [0, core, index];
  };
  return widgets
    .map((widget, index) => ({ widget, key: keyOfWidget(widget, index) }))
    .sort(
      (a, b) =>
        a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]
    )
    .map(({ widget }) => widget);
}

/** A collection the reader may read, as the gallery offers it. */
export interface GalleryCollection {
  slug: string;
  label: string;
  /** Whether it has a draft and published lifecycle, so a status split means something. */
  lifecycle: boolean;
  /**
   * How many entries the reader may read in it; absent when it was not
   * counted (past the read's bound, or a count that failed).
   */
  entries?: number;
}

/** The days a reader's saves are counted over, to rank their collections. */
export const GALLERY_EDIT_WINDOW_DAYS = 30;

/** One document the reader saved, as the activity trail answers it. */
export interface GallerySave {
  collection: string;
  /** `null` or absent on a row written before the kind was recorded: a collection's. */
  subjectKind?: string | null;
  /** When the save was made, as an ISO string. */
  createdAt: string;
}

/**
 * How many of each collection's entries the reader saved since `since`: one
 * per document, as the trail answers one row per document. A Single's or a
 * settings change's row names no collection's entry, and is not counted.
 */
export function editsByCollection(
  saves: readonly GallerySave[],
  since: Date
): Map<string, number> {
  const edits = new Map<string, number>();
  for (const save of saves) {
    if (save.subjectKind != null && save.subjectKind !== "collection") continue;
    const at = Date.parse(save.createdAt);
    if (!Number.isFinite(at) || at < since.getTime()) continue;
    edits.set(save.collection, (edits.get(save.collection) ?? 0) + 1);
  }
  return edits;
}

/** The reader's collections, best first, for the add step's default and the suggestions. */
export interface RankedCollections {
  ranked: GalleryCollection[];
  /** The collection the reader edited most in the window; absent when they edited none. */
  mostEdited?: string;
}

/** Most entries first, an uncounted collection last, then by label. */
function byEntries(a: GalleryCollection, b: GalleryCollection): number {
  return (
    (b.entries ?? -1) - (a.entries ?? -1) || a.label.localeCompare(b.label)
  );
}

/**
 * The reader's collections ranked: those they edited in the window, most
 * edits first (ties by entries, then label); with none edited, every readable
 * collection by its entries. Only the collections handed in are ranked, so a
 * save in a collection the reader may no longer read ranks nothing.
 */
export function rankCollections(
  collections: readonly GalleryCollection[],
  edits: ReadonlyMap<string, number>
): RankedCollections {
  const edited = collections
    .filter(collection => (edits.get(collection.slug) ?? 0) > 0)
    .sort(
      (a, b) =>
        (edits.get(b.slug) ?? 0) - (edits.get(a.slug) ?? 0) || byEntries(a, b)
    );
  const [first] = edited;
  if (first !== undefined) return { ranked: edited, mostEdited: first.slug };
  return { ranked: [...collections].sort(byEntries) };
}

/** A widget paired with a collection, as the Suggested row offers it. */
export interface GallerySuggestion {
  widgetId: string;
  collection: string;
  /** What the row says: "Recent Posts", "Pages over time", "Posts by status". */
  label: string;
}

/** The most suggestions the row shows. */
export const MAX_GALLERY_SUGGESTIONS = 4;

/**
 * The core widgets a suggestion pairs a collection with, in the order each
 * round offers them, and what each pair is called. Breakdown is suggested by
 * status, which it groups a lifecycle collection by unless told otherwise, so
 * only for a collection with one.
 */
const SUGGESTED_KINDS: ReadonlyArray<{
  widgetId: CoreWidgetId;
  label: (collection: string) => string;
  needsLifecycle?: true;
}> = [
  { widgetId: CORE_WIDGET_ID.recentEntries, label: c => `Recent ${c}` },
  { widgetId: CORE_WIDGET_ID.overTime, label: c => `${c} over time` },
  {
    widgetId: CORE_WIDGET_ID.breakdown,
    label: c => `${c} by status`,
    needsLifecycle: true,
  },
];

/**
 * Up to four pairs, from the ranked collections (`rankCollections`).
 *
 * Round by round, each kind of widget is paired with the next collection
 * along, so the top collections are spread across the row rather than one
 * collection taking it: with Posts and Pages, "Recent Posts", "Pages over
 * time", "Posts by status", then "Recent Pages". A pair is left out when its
 * widget is not offered to the reader, when it needs a lifecycle the
 * collection lacks, or when the reader already has that card. None at all
 * without a collection.
 */
export function suggestedPairs(input: {
  ranked: readonly GalleryCollection[];
  /** Whether the reader may add a card of this widget now. */
  offered: (widgetId: string) => boolean;
  /** Whether the reader's dashboard already holds this widget set to this collection. */
  onDashboard: (widgetId: string, collection: string) => boolean;
  max?: number;
}): GallerySuggestion[] {
  const { ranked, offered, onDashboard } = input;
  const max = input.max ?? MAX_GALLERY_SUGGESTIONS;
  const count = ranked.length;
  const pairs: GallerySuggestion[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < count && pairs.length < max; round += 1) {
    SUGGESTED_KINDS.forEach((kind, offset) => {
      if (pairs.length >= max) return;
      const collection = ranked[(round + offset) % count];
      const key = `${kind.widgetId}\u0000${collection.slug}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!offered(kind.widgetId)) return;
      if (kind.needsLifecycle === true && !collection.lifecycle) return;
      if (onDashboard(kind.widgetId, collection.slug)) return;
      pairs.push({
        widgetId: kind.widgetId,
        collection: collection.slug,
        label: kind.label(collection.label),
      });
    });
  }
  return pairs;
}

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

// Read here alone, now that the layout read sends no group: where a widget is
// listed only orders `available`.
type AddPanelGroup = (typeof ADD_PANEL_GROUPS)[number];

/**
 * Each built-in's group. Keyed by every core id, so a built-in added to core
 * without a group here does not compile.
 */
const CORE_GROUPS = {
  [CORE_WIDGET_ID.setup]: "overview",
  [CORE_WIDGET_ID.contentTable]: "overview",
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

/** Where the add panel lists a widget: its group, and within it its sub-group. */
interface AddPanelPlace {
  group: AddPanelGroup;
  /** The collection a Content card reads, or the plugin a Plugins one comes from. */
  subgroup?: string;
}

/** What the add panel shows about a widget beside its name. */
export interface AddPanelFacts {
  description?: string;
  /** The widget's declared category: searched, and shown as a label. */
  category?: string;
  /**
   * Listed once per collection the reader may read, each row adding a card
   * set to that collection. @experimental
   */
  perCollection?: true;
}

function isCoreWidgetId(id: string): id is CoreWidgetId {
  return Object.prototype.hasOwnProperty.call(CORE_GROUPS, id);
}

/**
 * The group and sub-group, which order the panel's rows (`inAddPanelOrder`).
 * Exported so the rule is tested on its own, beside the order it decides.
 */
export function addPanelPlace(widget: CanonicalWidget): AddPanelPlace {
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
    ...(widget.description === undefined
      ? {}
      : { description: widget.description }),
    ...(widget.category === undefined ? {} : { category: widget.category }),
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
  place: AddPanelPlace,
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
    key: keyOf(addPanelPlace(widget), widget, index, pluginOrder),
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
// The add gallery: what the reader may add, one row per widget, in one list,
// and the collections they may read. The read is the gallery route's
// (`api/dashboard-gallery`); the order it lists the widgets in is decided
// here, with nothing to read, so it is tested on its own.
// ────────────────────────────────────────────────────────────────────────

/**
 * Each built-in's place in the gallery's one list: the widgets a reader comes
 * to add first (the collection cards and the Note), then the default's cards,
 * which a reader adds back. Keyed by every core id, so a built-in added to
 * core without a place here does not compile.
 */
const CORE_GALLERY_PLACE = {
  [CORE_WIDGET_ID.count]: 0,
  [CORE_WIDGET_ID.recentEntries]: 1,
  [CORE_WIDGET_ID.overTime]: 2,
  [CORE_WIDGET_ID.breakdown]: 3,
  [CORE_WIDGET_ID.note]: 4,
  [CORE_WIDGET_ID.needsAttention]: 5,
  [CORE_WIDGET_ID.continue]: 6,
  [CORE_WIDGET_ID.upcomingReleases]: 7,
  [CORE_WIDGET_ID.contentTable]: 8,
  [CORE_WIDGET_ID.team]: 9,
  [CORE_WIDGET_ID.teamActivity]: 10,
  [CORE_WIDGET_ID.systemHealth]: 11,
  [CORE_WIDGET_ID.setup]: 12,
} as const satisfies Record<CoreWidgetId, number>;

const CORE_GALLERY_ORDER: ReadonlyMap<string, number> = new Map(
  Object.entries(CORE_GALLERY_PLACE)
);

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
}

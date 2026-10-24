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
 * A card core derives from a collection has no group at all and is never
 * offered: those cards are retired in favour of the catalogue's content
 * widgets, which are what the Content group is for. One already placed is
 * still drawn; it is simply not offered again.
 *
 * @module domains/widgets/add-panel
 */

import type { CanonicalWidget } from "./canonical";
import { CORE_WIDGETS, type CoreWidgetId } from "./core-widgets";

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
  "core/seed-demo-content": "overview",
  "core/onboarding-checklist": "overview",
  "core/content": "overview",
  "core/quick-create": "overview",
  "core/team": "team",
  "core/needs-attention": "overview",
  "core/recently-edited": "overview",
  "core/upcoming-releases": "overview",
  "core/recent-activity": "team",
  "core/count": "content",
  "core/note": "overview",
} as const satisfies Record<CoreWidgetId, AddPanelGroup>;

/** A built-in's place in core's own order, for Overview's first rows. */
const CORE_ORDER = new Map(
  CORE_WIDGETS.map((widget, index) => [widget.id, index])
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

/**
 * The group and sub-group, before the labels are added, or `undefined` for a
 * widget the panel does not offer.
 */
function placeOf(
  widget: CanonicalWidget
): Pick<AddPanelFacts, "group" | "subgroup"> | undefined {
  // A plugin's widget first: a plugin that overrides a built-in's id is still
  // the plugin's, and is found under it.
  if (widget.plugin !== undefined) {
    return { group: "plugins", subgroup: widget.plugin };
  }
  // Retired, so not offered; see the module note.
  if (widget.generated === true) return undefined;
  // Offered inside each collection's part of the Content group: the admin
  // lists it once per collection the reader may read, from the collections it
  // already holds, so no collection is named here.
  if (widget.offered === "per-collection") return { group: "content" };
  if (isCoreWidgetId(widget.id)) return { group: CORE_GROUPS[widget.id] };
  // The site's own: beside the built-ins, since it is the site's.
  return { group: "overview" };
}

/**
 * Where the panel lists `widget`, and what it shows beside its name, or
 * `undefined` when the panel does not offer it.
 */
export function addPanelFacts(
  widget: CanonicalWidget
): AddPanelFacts | undefined {
  const place = placeOf(widget);
  if (place === undefined) return undefined;
  return {
    ...place,
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

/**
 * The widgets the panel offers, in the order it lists them. A widget it does
 * not offer is left out.
 */
export function inAddPanelOrder<W extends CanonicalWidget>(
  widgets: readonly W[]
): W[] {
  const pluginOrder = new Map<string, number>();
  for (const widget of widgets) {
    if (widget.plugin !== undefined && !pluginOrder.has(widget.plugin)) {
      pluginOrder.set(widget.plugin, pluginOrder.size);
    }
  }
  const keyed = widgets.flatMap((widget, index) => {
    const place = placeOf(widget);
    return place === undefined
      ? []
      : [{ widget, key: keyOf(place, widget, index, pluginOrder) }];
  });
  keyed.sort(
    (a, b) =>
      a.key[0] - b.key[0] ||
      a.key[1].localeCompare(b.key[1]) ||
      a.key[2] - b.key[2]
  );
  return keyed.map(({ widget }) => widget);
}

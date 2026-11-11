/**
 * What the add panel lists, worked out from the server's gallery read and the reader's draft.
 *
 * The server decides what is offered, as the reader (`GET /api/dashboard/gallery`): which
 * widgets have a row, in what order, and the collections the reader may read. This module only
 * searches that answer, and says what each row's control does against the draft, since a card
 * added or removed a moment ago is in the draft and not yet in the server's answer.
 *
 * @module components/features/widgets/edit/add-panel-model
 */

import type { PublishedContentSource, WidgetSizeBounds } from "nextly/config";

import type { PluginMetadata } from "@admin/types/branding";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { askableWith } from "../widget-as-asked";

/**
 * One widget, as the gallery read sends it: the parts of the server's `GalleryTileItem` this
 * admin reads. What is placed is read from the draft instead, which a card added or removed a
 * moment ago has changed and the read has not.
 */
export interface GalleryTile {
  id: string;
  name: string;
  description?: string;
  /** The plugin that declared it, by its name; absent for core's and the site's. */
  plugin?: string;
  /** The widths its cards may take, and the size a new one starts at. */
  size: WidgetSizeBounds;
  allowsSeveral: boolean;
  /** Its Collection setting's name, which a new card stores the collection under. */
  collectionSetting?: string;
}

/** A collection the reader may read, as the gallery read sends it. */
export interface GalleryCollection {
  slug: string;
  label: string;
  lifecycle: boolean;
}

/** The gallery read (`GET /api/dashboard/gallery`). */
export interface GalleryRead {
  tiles: GalleryTile[];
  collections: GalleryCollection[];
}

/** What a row's control does, against the draft. */
export type RowAction =
  | { kind: "add" }
  /** A one-card widget whose card was removed this session: Add puts that card back. */
  | { kind: "add-back"; placementId: string }
  /** A one-card widget the draft already holds. */
  | { kind: "on-dashboard" }
  /** It reads a collection, and the reader may read none it can ask anything of. */
  | { kind: "needs-collection" };

/** One row of the list: the widget, what its control does, and the plugin it comes from. */
export interface GalleryRow {
  tile: GalleryTile;
  action: RowAction;
  /** The plugin's name as the admin shows it, for a plugin's widget. */
  pluginName?: string;
}

/**
 * What a plugin is called beside its widget's name: the label the plugin gives itself in the
 * admin, else the name the plugin catalogue knows it by ("SEO"), else its package name without
 * its scope and a `plugin-` prefix, so "@acme/plugin-reviews" reads "reviews".
 */
export function pluginShownName(
  plugin: string,
  meta: Pick<PluginMetadata, "appearance"> | undefined,
  catalogue: ReadonlyArray<{ id: string; name: string }>
): string {
  const label = meta?.appearance?.label;
  if (label) return label;
  const known = catalogue.find(entry => entry.id === plugin)?.name;
  if (known !== undefined) return known;
  return plugin.replace(/^@[^/]+\//, "").replace(/^plugin-/, "");
}

/** Whether a card of this widget set to this collection can be asked anything. */
export type CanAsk = (widgetId: string, collection: string) => boolean;

/**
 * Whether a card of a widget, set to a collection, can be asked anything, by the rule the
 * dashboard draws such a card by (`askableWith`): a Breakdown, say, asks nothing of a collection
 * with nothing to group its entries by. A widget this admin cannot draw, or one with no Collection
 * setting, can be set to none.
 */
export function collectionAsker(
  byId: ReadonlyMap<string, DashboardWidget>,
  sources: readonly PublishedContentSource[] | undefined
): CanAsk {
  return (widgetId, collection) => {
    const widget = byId.get(widgetId);
    const setting = widget?.settings?.find(s => s.type === "collection")?.name;
    if (widget === undefined || setting === undefined) return false;
    return askableWith(widget, { [setting]: collection }, sources);
  };
}

/** The collections a widget may be set to: those it can ask anything of, in the read's order. */
export function collectionsFor(
  widgetId: string,
  collections: readonly GalleryCollection[],
  canAsk: CanAsk
): GalleryCollection[] {
  return collections.filter(collection => canAsk(widgetId, collection.slug));
}

/** Whether a row's Add is offered: not a placed one-card widget, nor one with no collection. */
export function canAdd(row: GalleryRow): boolean {
  return row.action.kind === "add" || row.action.kind === "add-back";
}

/**
 * A row for each widget the server sent that this admin can draw, named as this admin names the
 * widget, in the read's order, with what its control does in the draft as it stands. A widget it
 * holds no definition for has no row: a card of it would be added, saved and never drawn, with no
 * controls to remove it.
 *
 * - one card only, and the draft holds it: "On dashboard", nothing to add;
 * - one card only, and it was removed this session: Add puts that card back, with its settings,
 *   rather than adding a second;
 * - it reads a collection, and none the reader may read is one it can ask anything of
 *   (`canAsk`): listed, saying so, with nothing to add, so no card lands that could only ever be
 *   drawn as not available;
 * - otherwise Add.
 */
export function galleryRows(
  read: GalleryRead,
  placements: readonly WidgetPlacement[],
  byId: ReadonlyMap<string, DashboardWidget>,
  canAsk: CanAsk,
  pluginName: (plugin: string) => string = plugin => plugin
): GalleryRow[] {
  return read.tiles.flatMap((sent): GalleryRow[] => {
    const widget = byId.get(sent.id);
    if (widget === undefined) return [];
    // The title the dashboard draws the card with, whichever channel declared it.
    const tile = { ...sent, name: widget.title };
    const named =
      tile.plugin === undefined ? {} : { pluginName: pluginName(tile.plugin) };
    return [
      { tile, action: actionOf(tile, placements, read, canAsk), ...named },
    ];
  });
}

/** What a row's control does against the draft (`galleryRows`). */
function actionOf(
  tile: GalleryTile,
  placements: readonly WidgetPlacement[],
  read: GalleryRead,
  canAsk: CanAsk
): RowAction {
  const mine = placements.filter(p => p.widgetId === tile.id);
  if (!tile.allowsSeveral) {
    if (mine.some(p => !p.removed)) return { kind: "on-dashboard" };
    const removed = mine.find(p => p.removed);
    if (removed !== undefined) {
      return { kind: "add-back", placementId: removed.id };
    }
  }
  if (
    tile.collectionSetting !== undefined &&
    collectionsFor(tile.id, read.collections, canAsk).length === 0
  ) {
    return { kind: "needs-collection" };
  }
  return { kind: "add" };
}

/**
 * The rows a query keeps, ignoring case: each whose name, description or plugin's name contains
 * it. An empty query keeps every row.
 */
export function searchRows(
  rows: readonly GalleryRow[],
  query: string
): GalleryRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter(row =>
    [row.tile.name, row.tile.description, row.pluginName].some(text =>
      text?.toLowerCase().includes(needle)
    )
  );
}

/** What the count line under the search says, and what is announced when a search changes it. */
export function rowsCount(count: number): string {
  return `${count} ${count === 1 ? "widget" : "widgets"}`;
}

/**
 * The collection a new card of a widget starts on, of those it may be set to (`collections`):
 * the first that no card of the widget on the dashboard is set to yet, so a second Count counts
 * another collection. `taken` when every one has such a card already, and the first is given:
 * the new card then matches one the reader has, and its settings are opened to tell them apart.
 * `undefined` when there is none to start on.
 */
export function startingCollection(
  tile: GalleryTile,
  collections: readonly GalleryCollection[],
  placements: readonly WidgetPlacement[]
): { slug: string; taken: boolean } | undefined {
  const setting = tile.collectionSetting;
  if (setting === undefined) return undefined;
  const used = new Set(
    placements
      .filter(p => p.widgetId === tile.id && !p.removed)
      .map(p => p.config?.[setting])
  );
  const free = collections.find(collection => !used.has(collection.slug));
  if (free !== undefined) return { slug: free.slug, taken: false };
  const [first] = collections;
  return first === undefined ? undefined : { slug: first.slug, taken: true };
}

/** The settings a new card starts with: the collection it starts on, where it reads one. */
export function newCardSettings(
  tile: GalleryTile,
  collection: string | undefined
): Record<string, unknown> | undefined {
  return tile.collectionSetting === undefined || collection === undefined
    ? undefined
    : { [tile.collectionSetting]: collection };
}

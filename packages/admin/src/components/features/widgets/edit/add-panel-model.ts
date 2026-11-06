/**
 * What the add gallery lists, worked out from the server's gallery read and the reader's draft.
 *
 * The server decides everything about what is offered, as the reader (`GET
 * /api/dashboard/gallery`): which widgets have a tile, the chip each is under, the collections the
 * reader may read, the one they edit most, and the pairs to suggest. This module only filters and
 * searches that answer, and says what each tile's control does against the draft, since a card
 * added or removed a moment ago is in the draft and not yet in the server's answer.
 *
 * @module components/features/widgets/edit/add-panel-model
 */

import type { PublishedContentSource, WidgetSizeBounds } from "nextly/config";
import type { WidgetResult } from "nextly/widget-result";

import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { widthChoiceName, widthChoices } from "../sizes";
import { askableWith } from "../widget-as-asked";

/** The chips past All, as the server names a tile's. */
export type GalleryCategory = "content" | "activity" | "trends" | "plugins";

/**
 * One widget's tile, as the gallery read sends it: the parts of the server's `GalleryTileItem`
 * this admin reads. What is placed is read from the draft instead, which a card added or removed a
 * moment ago has changed and the read has not.
 */
export interface GalleryTile {
  id: string;
  name: string;
  description?: string;
  /** Its chip past All; none for a widget listed under All alone. */
  category?: GalleryCategory;
  /** Its own free-text category, searched beside the chip's label. */
  declaredCategory?: string;
  /** The widths its cards may take, and the size a new one starts at. */
  size: WidgetSizeBounds;
  allowsSeveral: boolean;
  /** Its Collection setting's name, which a new card stores the collection under. */
  collectionSetting?: string;
  /** Its first declared preview case, carried as a card's answer is. */
  preview?: { result: WidgetResult; settings?: Record<string, unknown> };
}

/** A collection the reader may read, as the gallery read sends it. */
export interface GalleryCollection {
  slug: string;
  label: string;
  lifecycle: boolean;
  entries?: number;
}

/** A widget and collection the Suggested row offers. */
export interface GallerySuggestion {
  widgetId: string;
  collection: string;
  label: string;
}

/** The gallery read (`GET /api/dashboard/gallery`). */
export interface GalleryRead {
  tiles: GalleryTile[];
  collections: GalleryCollection[];
  mostEdited?: string;
  suggested: GallerySuggestion[];
}

/** A filter chip: All, or one of the categories. */
export type GalleryChip = "all" | GalleryCategory;

/** The chips in their order, each with what it says. */
export const GALLERY_CHIPS: ReadonlyArray<{ id: GalleryChip; label: string }> =
  [
    { id: "all", label: "All" },
    { id: "content", label: "Content" },
    { id: "activity", label: "Activity" },
    { id: "trends", label: "Trends" },
    { id: "plugins", label: "Plugins" },
  ];

/** What choosing a tile does, against the draft. */
export type TileAction =
  | { kind: "add" }
  | { kind: "add-another" }
  | { kind: "on-dashboard" }
  /** It reads a collection, and none the reader may read is one it can ask anything of. */
  | { kind: "no-collection" };

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

/** Whether a tile can be chosen now: not one already on the dashboard, nor one with no collection. */
export function canChoose(view: GalleryTileView): boolean {
  return view.action.kind === "add" || view.action.kind === "add-another";
}

/** A tile as the gallery draws it now. */
export interface GalleryTileView {
  tile: GalleryTile;
  action: TileAction;
  /** How many of its cards the draft holds, removed ones not counted. */
  placed: number;
}

/**
 * Each tile the server sent that this admin can draw, named as this admin names the widget, with
 * what its control does in the draft as it stands. A widget it holds no definition for has no
 * tile: a card of it would be added, saved and never drawn, with no controls to remove it.
 *
 * - one card only, and the draft holds it: "On your dashboard", not addable;
 * - one card only, and it was removed this session: no tile, since its card is listed under
 *   Removed, where adding it back restores its settings, and a fresh card would be a second;
 * - it reads a collection, and none the reader may read is one it can ask anything of
 *   (`canAsk`): shown, saying so, not addable, so no card lands that would draw as unavailable;
 * - otherwise Add, or Add another once one is placed.
 */
export function galleryTiles(
  read: Pick<GalleryRead, "tiles"> & Partial<Pick<GalleryRead, "collections">>,
  placements: readonly WidgetPlacement[],
  byId: ReadonlyMap<string, DashboardWidget>,
  canAsk: CanAsk = () => true
): GalleryTileView[] {
  return read.tiles.flatMap((sent): GalleryTileView[] => {
    const widget = byId.get(sent.id);
    if (widget === undefined) return [];
    // The title the dashboard draws the card with, whichever channel declared it.
    const tile = { ...sent, name: widget.title };
    const mine = placements.filter(p => p.widgetId === tile.id);
    const placed = mine.filter(p => !p.removed).length;
    if (!tile.allowsSeveral && placed > 0) {
      return [{ tile, placed, action: { kind: "on-dashboard" } }];
    }
    if (!tile.allowsSeveral && mine.some(p => p.removed)) return [];
    if (
      tile.collectionSetting !== undefined &&
      collectionsFor(tile.id, read.collections ?? [], canAsk).length === 0
    ) {
      return [{ tile, placed, action: { kind: "no-collection" } }];
    }
    return [
      {
        tile,
        placed,
        action: placed > 0 ? { kind: "add-another" } : { kind: "add" },
      },
    ];
  });
}

/** A card removed this session, offered first so it can come back as it was. */
export interface RemovedCard {
  placementId: string;
  widgetId: string;
  title: string;
}

/** The draft's removed cards this admin can draw, in the draft's order. */
export function removedCards(
  placements: readonly WidgetPlacement[],
  byId: ReadonlyMap<string, DashboardWidget>
): RemovedCard[] {
  return placements.flatMap(placement => {
    const widget = byId.get(placement.widgetId);
    if (!placement.removed || widget === undefined) return [];
    return [
      {
        placementId: placement.id,
        widgetId: placement.widgetId,
        title: widget.title,
      },
    ];
  });
}

/** The tiles a chip keeps: every one under All. */
export function tilesInChip(
  tiles: readonly GalleryTileView[],
  chip: GalleryChip
): GalleryTileView[] {
  return chip === "all"
    ? [...tiles]
    : tiles.filter(view => view.tile.category === chip);
}

/** A widget with a collection already chosen, as a search for the collection lists it. */
export interface GalleryPair {
  key: string;
  view: GalleryTileView;
  collection: GalleryCollection;
  /** "Count · Posts". */
  label: string;
}

/** What a search kept. */
export interface GallerySearch {
  removed: RemovedCard[];
  tiles: GalleryTileView[];
  pairs: GalleryPair[];
}

/** A chip's label, which search reads as the tile's category. */
function chipLabel(category: GalleryCategory | undefined): string | undefined {
  return GALLERY_CHIPS.find(chip => chip.id === category)?.label;
}

/** Whether a tile's own words contain the needle. */
function tileMatches(tile: GalleryTile, needle: string): boolean {
  return [
    tile.name,
    tile.description,
    tile.declaredCategory,
    chipLabel(tile.category),
  ].some(text => text?.toLowerCase().includes(needle));
}

/**
 * The removed cards, tiles and pairs a query keeps, ignoring case:
 *
 * - a tile whose name, description or category contains it;
 * - for each collection whose label contains it, every widget that reads a collection and can be
 *   added, as a pair that adds with that collection chosen;
 * - a removed card whose title contains it.
 *
 * An empty query keeps every removed card and tile, and lists no pairs.
 */
export function searchGallery(
  input: {
    removed: readonly RemovedCard[];
    tiles: readonly GalleryTileView[];
    collections: readonly GalleryCollection[];
    /** Which collections each widget can be set to; every one when absent. */
    canAsk?: CanAsk;
  },
  query: string
): GallerySearch {
  const canAsk = input.canAsk ?? (() => true);
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return { removed: [...input.removed], tiles: [...input.tiles], pairs: [] };
  }
  const matched = input.collections.filter(collection =>
    collection.label.toLowerCase().includes(needle)
  );
  const readers = input.tiles.filter(
    view => view.tile.collectionSetting !== undefined && canChoose(view)
  );
  return {
    removed: input.removed.filter(card =>
      card.title.toLowerCase().includes(needle)
    ),
    tiles: input.tiles.filter(view => tileMatches(view.tile, needle)),
    pairs: matched.flatMap(collection =>
      readers
        .filter(view => canAsk(view.tile.id, collection.slug))
        .map(view => ({
          key: `${view.tile.id}:${collection.slug}`,
          view,
          collection,
          label: `${view.tile.name} · ${collection.label}`,
        }))
    ),
  };
}

/** How many things a search found: removed cards, tiles and pairs. */
export function foundCount(found: GallerySearch): number {
  return found.removed.length + found.tiles.length + found.pairs.length;
}

/** What the count line says, and what is announced when it changes. */
export function galleryCount(found: number, query: string): string {
  const trimmed = query.trim();
  if (trimmed === "") return `${found} ${found === 1 ? "widget" : "widgets"}`;
  return `${found} ${found === 1 ? "result" : "results"} for “${trimmed}”`;
}

/**
 * The server's suggestions the draft still has room for: each whose widget has a tile that can
 * be added, and whose card, set to that collection, the draft does not already hold.
 */
export function suggestionsFor(
  read: Pick<GalleryRead, "suggested">,
  tiles: readonly GalleryTileView[],
  placements: readonly WidgetPlacement[],
  canAsk: CanAsk = () => true
): Array<GallerySuggestion & { view: GalleryTileView }> {
  return read.suggested.flatMap(suggestion => {
    const view = tiles.find(each => each.tile.id === suggestion.widgetId);
    const setting = view?.tile.collectionSetting;
    if (
      view === undefined ||
      setting === undefined ||
      !canChoose(view) ||
      !canAsk(suggestion.widgetId, suggestion.collection)
    ) {
      return [];
    }
    const held = placements.some(
      p =>
        p.widgetId === suggestion.widgetId &&
        !p.removed &&
        p.config?.[setting] === suggestion.collection
    );
    return held ? [] : [{ ...suggestion, view }];
  });
}

/**
 * The collection a new card starts on, of those it may be set to (`collections`, every one the
 * reader may read when absent): the reader's most-edited one, else the first. `undefined` when
 * there is none, and then a card that reads one cannot be added.
 */
export function startingCollection(
  read: Pick<GalleryRead, "collections" | "mostEdited">,
  collections: readonly GalleryCollection[] = read.collections
): string | undefined {
  const edited = collections.find(c => c.slug === read.mostEdited);
  return edited?.slug ?? collections[0]?.slug;
}

/** A widget's period, as the add step offers it. */
export interface PeriodChoice {
  /** The setting's name, which the new card's settings store it under. */
  name: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** The value a new card starts with. */
  initial: string;
}

/**
 * The widget's period: a choice named `dateRange`, the name core reads as how far back a card's
 * read reaches. `undefined` for a widget without one, which then has no period to choose.
 */
export function periodOf(
  widget: DashboardWidget | undefined
): PeriodChoice | undefined {
  const setting = widget?.settings?.find(
    each => each.type === "select" && each.name === "dateRange"
  );
  if (setting === undefined || setting.type !== "select") return undefined;
  const options = setting.options.map(option => ({
    value: String(option.value),
    label: option.label,
  }));
  const declared =
    typeof setting.defaultValue === "string" ? setting.defaultValue : undefined;
  const initial = options.find(option => option.value === declared)?.value;
  const first = initial ?? options[0]?.value;
  if (first === undefined) return undefined;
  return { name: setting.name, options, initial: first };
}

/** One width the add step offers. */
export interface WidthChoice {
  w: number;
  label: string;
  spoken: string;
}

/** The widths a new card may start at, narrowest first, within the widget's sizes. */
export function addWidths(size: WidgetSizeBounds): WidthChoice[] {
  return widthChoices(size).map(w => {
    const name = widthChoiceName(w);
    return { w, label: name.label, spoken: name.spoken };
  });
}

/** What a tile says about its widths: its one width, or the narrowest and widest. */
export function widthsLabel(size: WidgetSizeBounds): string {
  const narrowest = widthChoiceName(size.min.w).label;
  if (size.min.w === size.max.w) return `${narrowest} width`;
  return `${narrowest} to ${widthChoiceName(size.max.w).label} width`;
}

/** The settings a new card starts with: the collection chosen, and the period when it has one. */
export function newCardSettings(
  tile: GalleryTile,
  choice: { collection?: string; period?: { name: string; value: string } }
): Record<string, unknown> | undefined {
  const settings: Record<string, unknown> = {};
  if (tile.collectionSetting !== undefined && choice.collection !== undefined) {
    settings[tile.collectionSetting] = choice.collection;
  }
  if (choice.period !== undefined) {
    settings[choice.period.name] = choice.period.value;
  }
  return Object.keys(settings).length === 0 ? undefined : settings;
}

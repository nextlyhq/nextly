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

import type { WidgetSizeBounds } from "nextly/config";
import type { WidgetResult } from "nextly/widget-result";

import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { widthChoiceName, widthChoices } from "../sizes";

/** The chips past All, as the server names a tile's. */
export type GalleryCategory = "content" | "activity" | "trends" | "plugins";

/** One widget's tile, as the gallery read sends it. */
export interface GalleryTile {
  id: string;
  name: string;
  description?: string;
  /** The chip it is listed under past All; absent for a widget under All alone. */
  category?: GalleryCategory;
  /** The declaration's own free-text category, which search reads too. */
  declaredCategory?: string;
  size: WidgetSizeBounds;
  /** The Collection setting its card reads, by name; absent when it reads none. */
  collectionSetting?: string;
  allowsSeveral: boolean;
  /** Whether the server would take a new card of it now. */
  offered: boolean;
  /** How many of its cards the reader's saved dashboard holds. */
  placed: number;
  /** Its first declared preview case, as its card carries an answer. */
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
  | { kind: "on-dashboard" };

/** A tile as the gallery draws it now. */
export interface GalleryTileView {
  tile: GalleryTile;
  action: TileAction;
  /** How many of its cards the draft holds, removed ones not counted. */
  placed: number;
}

/**
 * Each tile the server sent, with what its control does in the draft as it stands:
 *
 * - one card only, and the draft holds it: "On your dashboard", not addable;
 * - one card only, and it was removed this session: no tile, since its card is listed under
 *   Removed, where adding it back restores its settings, and a fresh card would be a second;
 * - otherwise Add, or Add another once one is placed.
 */
export function galleryTiles(
  read: Pick<GalleryRead, "tiles">,
  placements: readonly WidgetPlacement[]
): GalleryTileView[] {
  return read.tiles.flatMap((tile): GalleryTileView[] => {
    const mine = placements.filter(p => p.widgetId === tile.id);
    const placed = mine.filter(p => !p.removed).length;
    if (!tile.allowsSeveral && placed > 0) {
      return [{ tile, placed, action: { kind: "on-dashboard" } }];
    }
    if (!tile.allowsSeveral && mine.some(p => p.removed)) return [];
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
  },
  query: string
): GallerySearch {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return { removed: [...input.removed], tiles: [...input.tiles], pairs: [] };
  }
  const matched = input.collections.filter(collection =>
    collection.label.toLowerCase().includes(needle)
  );
  const readers = input.tiles.filter(
    view =>
      view.tile.collectionSetting !== undefined &&
      view.action.kind !== "on-dashboard"
  );
  return {
    removed: input.removed.filter(card =>
      card.title.toLowerCase().includes(needle)
    ),
    tiles: input.tiles.filter(view => tileMatches(view.tile, needle)),
    pairs: matched.flatMap(collection =>
      readers.map(view => ({
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
  placements: readonly WidgetPlacement[]
): Array<GallerySuggestion & { view: GalleryTileView }> {
  return read.suggested.flatMap(suggestion => {
    const view = tiles.find(each => each.tile.id === suggestion.widgetId);
    const setting = view?.tile.collectionSetting;
    if (
      view === undefined ||
      setting === undefined ||
      view.action.kind === "on-dashboard"
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
 * The collection a new card starts on: the reader's most-edited one, else the first they may
 * read. `undefined` when they may read none, and then a card that reads one cannot be added.
 */
export function startingCollection(
  read: Pick<GalleryRead, "collections" | "mostEdited">
): string | undefined {
  const edited = read.collections.find(c => c.slug === read.mostEdited);
  return edited?.slug ?? read.collections[0]?.slug;
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

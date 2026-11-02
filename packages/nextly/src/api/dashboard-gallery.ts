/**
 * GET `/api/dashboard/gallery`
 *
 * What the dashboard's add gallery offers one reader (dashboard-experience
 * R-19, R-20), decided here, as that reader, and only filtered and searched by
 * the admin:
 *
 * - **tiles**, one per widget they may add or already have: by the layout
 *   read's own audience, conditions and offer (`galleryOffer`), then each
 *   declared widget's `access` and `shows` judged with the person, as a card
 *   of it would be (`defaultCardsNotShown`), so a widget they could never see
 *   is not offered;
 * - **collections**, the ones they may read that the dashboard shows (a
 *   collection internal, hidden from the navigation or removed from code has
 *   no content source, so it is never among them), each with how many entries
 *   they may read in it;
 * - **mostEdited**, the collection whose entries they saved most in the last
 *   30 days, by the activity trail Continue where you left off reads;
 * - **suggested**, up to four widget and collection pairs (`suggestedPairs`).
 *
 * Every read is bounded: the trail by its own walk and the widget limit, the
 * counts by `MAX_COUNTED_COLLECTIONS`, `COUNT_CONCURRENCY` at a time.
 *
 * @module api/dashboard-gallery
 */

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di/container";
import {
  editsByCollection,
  galleryCategoryOf,
  GALLERY_EDIT_WINDOW_DAYS,
  inGalleryOrder,
  rankCollections,
  suggestedPairs,
  type GalleryCategory,
  type GalleryCollection,
  type GallerySuggestion,
} from "../domains/widgets/add-panel";
import { sizeFacts, type CanonicalWidget } from "../domains/widgets/canonical";
import { cardAnswerResult } from "../domains/widgets/declaration/card-answer";
import {
  CORE_OWNER,
  declaredWidget,
} from "../domains/widgets/declaration/declared-widgets";
import { bindReadServices } from "../domains/widgets/declaration/read-services";
import { SITE_CONFIG } from "../domains/widgets/declaration/site-component";
import type { WidgetSizeBounds } from "../domains/widgets/grid-size";
import type { WidgetPlacement } from "../domains/widgets/layout";
import { publishableContentSources } from "../domains/widgets/publish";
import { MAX_WIDGET_LIMIT } from "../domains/widgets/query-limits";
import { getWidget } from "../domains/widgets/registry";
import type { WidgetResult } from "../domains/widgets/result";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import { readActivitySubjects } from "../services/dashboard/activity-subjects";
import type { ReadCaller } from "../services/dashboard/readable-resources";
import { resolveReadableResources } from "../services/dashboard/resolve-readable-resources";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { defaultCardsNotShown } from "./default-cards-shown";
import { respondData } from "./response-shapes";
import { galleryOffer, type GalleryOffer } from "./widget-layout";
import { cardBatchFor } from "./widget-query";
import { withErrorHandler } from "./with-error-handler";

/** One widget as the gallery draws its tile. */
export interface GalleryTileItem {
  id: string;
  name: string;
  description?: string;
  /** The chip it is listed under past All; absent for a widget under All alone. */
  category?: GalleryCategory;
  /** The declaration's free-text category, which search reads too. */
  declaredCategory?: string;
  /** The sizes its cards may take, every end filled in. */
  size: WidgetSizeBounds;
  /** The Collection setting a card of it reads, by name; absent when it reads none. */
  collectionSetting?: string;
  allowsSeveral: boolean;
  /** Whether the reader may add a new card of it now. */
  offered: boolean;
  /** How many of its cards are on the reader's dashboard, removed ones not counted. */
  placed: number;
  /**
   * Its first declared preview case, as its card carries an answer, to draw the
   * tile's preview with its own view; absent for a widget that declares none.
   */
  preview?: { result: WidgetResult; settings?: Record<string, unknown> };
}

/** The gallery read's answer. */
export interface GalleryRead extends Record<string, unknown> {
  tiles: GalleryTileItem[];
  collections: GalleryCollection[];
  mostEdited?: string;
  suggested: GallerySuggestion[];
}

/**
 * The most collections whose entries one gallery read counts, and only when
 * the suggestions fall back to entries: the first this many in the sources'
 * order.
 */
const MAX_COUNTED_COLLECTIONS = 10;

/** How many of those counts run at once. */
const COUNT_CONCURRENCY = 4;

const DAY_MS = 86_400_000;

/**
 * The widgets the reader is shown a tile for: those they may add now, and
 * those they already have (a one-card widget's tile says so), each a declared
 * widget only when its own `access` and `shows` admit them, judged as a card
 * of it with no settings yet would be. A widget reading a collection is judged
 * before one is chosen, and its card asks for one, so it is shown.
 */
async function tileWidgets(
  offer: GalleryOffer,
  signal: AbortSignal
): Promise<CanonicalWidget[]> {
  const placed = new Set(
    offer.placements
      .filter(placement => placement.removed !== true)
      .map(placement => placement.widgetId)
  );
  const candidates = offer.widgets.filter(
    widget => offer.offered.has(widget.id) || placed.has(widget.id)
  );
  const asked: WidgetPlacement[] = candidates.map(widget => {
    const { size } = sizeFacts(widget);
    return {
      id: `gallery:${widget.id}`,
      widgetId: widget.id,
      w: size.default.w,
      h: size.default.h,
      removed: false,
    };
  });
  const notShown = await defaultCardsNotShown(
    offer.auth,
    offer.reader,
    asked,
    signal
  );
  return candidates.filter(widget => !notShown.has(`gallery:${widget.id}`));
}

/**
 * `widget` with the plugin it comes from: the contribution channel's, or, for a widget declared
 * with `defineWidget`, its declaration's owner when that is neither core nor the site config, so
 * a plugin's declared widget is listed under Plugins, beside its plugin's other widgets.
 */
function withPlugin(widget: CanonicalWidget): CanonicalWidget {
  if (widget.plugin !== undefined) return widget;
  const owner = declaredWidget(widget.id)?.owner;
  if (owner === undefined || owner === CORE_OWNER || owner === SITE_CONFIG) {
    return widget;
  }
  return { ...widget, plugin: owner };
}

/**
 * Core's own widget's first preview case as its card would carry it, or none.
 *
 * 🔴 Core's alone: its cases are sample data written for its gallery tiles. A
 * plugin's or the site's cases are their authors' fixtures, which the
 * declaration's contract keeps on the server for the development preview read
 * (`DeclaredWidgetShape.preview`), so they never reach this read, whoever
 * asks; such a tile is drawn as its sketch.
 */
function previewOf(widgetId: string): GalleryTileItem["preview"] {
  const declared = declaredWidget(widgetId);
  const first = declared?.declaration.preview?.[0];
  if (
    declared === undefined ||
    declared.owner !== CORE_OWNER ||
    first === undefined
  ) {
    return undefined;
  }
  try {
    return {
      result: cardAnswerResult(declared.display, first.data, {
        widget: declared.declaration.id,
        owner: declared.owner,
      }),
      ...(first.settings === undefined ? {} : { settings: first.settings }),
    };
  } catch {
    // A case its card could not carry is drawn as the tile's sketch instead;
    // the preview page is where its author is told why.
    return undefined;
  }
}

function tileOf(widget: CanonicalWidget, offer: GalleryOffer): GalleryTileItem {
  const declared = declaredWidget(widget.id);
  const facts = sizeFacts(widget);
  const category = galleryCategoryOf(widget);
  const preview = previewOf(widget.id);
  return {
    id: widget.id,
    // The title the admin resolves too, from either channel, before the id.
    name:
      declared?.declaration.title ?? getWidget(widget.id)?.title ?? widget.id,
    ...(widget.description === undefined
      ? {}
      : { description: widget.description }),
    ...(category === undefined ? {} : { category }),
    ...(widget.category === undefined
      ? {}
      : { declaredCategory: widget.category }),
    size: facts.size,
    ...(widget.collectionSetting === undefined
      ? {}
      : { collectionSetting: widget.collectionSetting.name }),
    allowsSeveral: facts.allowsSeveral,
    offered: offer.offered.has(widget.id),
    placed: offer.placements.filter(
      placement =>
        placement.widgetId === widget.id && placement.removed !== true
    ).length,
    ...(preview === undefined ? {} : { preview }),
  };
}

/** The collections the reader may read that the dashboard shows, in the sources' order. */
function readableCollections(offer: GalleryOffer): GalleryCollection[] {
  return publishableContentSources(offer.readableCollections).map(source => ({
    slug: source.collection,
    label: source.label,
    lifecycle: source.lifecycle,
  }));
}

/**
 * `collections` with the entries the reader may read in each of the first
 * `MAX_COUNTED_COLLECTIONS`, counted as the reader through the read services a
 * card is handed, so a count is exactly what a Count card of it would say. A
 * count that fails, and every collection past the bound, is left uncounted.
 * Asked only when the suggestions fall back to entries (`galleryFor`).
 */
async function withEntries(
  offer: GalleryOffer,
  collections: readonly GalleryCollection[],
  signal: AbortSignal
): Promise<GalleryCollection[]> {
  const batch = cardBatchFor(offer.auth, offer.reader);
  const services = bindReadServices({
    caller: batch.caller,
    prepare: batch.check,
    signal,
    now: new Date(),
  });
  const countOne = async (slug: string): Promise<number | undefined> => {
    try {
      return await services.count(slug, { status: "all" });
    } catch {
      return undefined;
    }
  };
  // A few at a time, in order, so a site with many collections does not ask
  // the database for every count at once.
  const counted: (number | undefined)[] = [];
  const counting = collections.slice(0, MAX_COUNTED_COLLECTIONS);
  for (let at = 0; at < counting.length; at += COUNT_CONCURRENCY) {
    counted.push(
      ...(await Promise.all(
        counting
          .slice(at, at + COUNT_CONCURRENCY)
          .map(collection => countOne(collection.slug))
      ))
    );
  }
  return collections.map((collection, index) => {
    const entries = counted[index];
    return entries === undefined ? collection : { ...collection, entries };
  });
}

/** The person a caller is, or none for an API key. */
function personOf(caller: ReadCaller): string | undefined {
  if (caller.authenticatedScope?.actorType === "apiKey") return undefined;
  return typeof caller.user?.id === "string" ? caller.user.id : undefined;
}

/**
 * How many documents of each collection the reader saved in the window: their
 * own latest saves, one per document, as the trail answers Continue's Mine
 * tab, read and authorized as the reader, the newest `MAX_WIDGET_LIMIT` of
 * them. No trail, or a read that fails, ranks by entries instead.
 */
async function readerEdits(
  caller: ReadCaller,
  now: Date
): Promise<Map<string, number>> {
  const person = personOf(caller);
  if (person === undefined || !container.has("activityLogService")) {
    return new Map();
  }
  try {
    const subjects = await readActivitySubjects();
    const { edits } = await container
      .get<ActivityLogService>("activityLogService")
      .getRecentEdits({
        limit: MAX_WIDGET_LIMIT,
        savedBy: person,
        scope: await resolveReadableResources(caller),
        caller,
        ...subjects,
      });
    return editsByCollection(
      edits,
      new Date(now.getTime() - GALLERY_EDIT_WINDOW_DAYS * DAY_MS)
    );
  } catch {
    return new Map();
  }
}

/** Whether the reader's dashboard holds a card of this widget set to this collection. */
function placedOn(
  tiles: readonly GalleryTileItem[],
  placements: readonly WidgetPlacement[]
): (widgetId: string, collection: string) => boolean {
  return (widgetId, collection) => {
    const setting = tiles.find(tile => tile.id === widgetId)?.collectionSetting;
    return (
      setting !== undefined &&
      placements.some(
        placement =>
          placement.widgetId === widgetId &&
          placement.removed !== true &&
          placement.config?.[setting] === collection
      )
    );
  };
}

/** The gallery for one signed-in reader. */
async function galleryFor(
  auth: AuthContext,
  signal: AbortSignal
): Promise<GalleryRead> {
  const offer = await galleryOffer(auth, signal);
  const now = new Date();
  const [widgets, edits] = await Promise.all([
    tileWidgets(offer, signal),
    readerEdits(offer.reader, now),
  ]);
  const readable = readableCollections(offer);
  // Counted only when the suggestions fall back to entries: a reader who
  // edited a readable collection in the window is suggested from their edits.
  const collections = readable.some(c => (edits.get(c.slug) ?? 0) > 0)
    ? readable
    : await withEntries(offer, readable, signal);
  const tiles = inGalleryOrder(widgets.map(withPlugin)).map(widget =>
    tileOf(widget, offer)
  );
  const { ranked, mostEdited } = rankCollections(collections, edits);
  const addable = new Set(
    tiles.filter(tile => tile.offered).map(tile => tile.id)
  );
  return {
    tiles,
    collections,
    ...(mostEdited === undefined ? {} : { mostEdited }),
    suggested: suggestedPairs({
      ranked,
      offered: widgetId => addable.has(widgetId),
      onDashboard: placedOn(tiles, offer.placements),
    }),
  };
}

export const getDashboardGallery = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  return respondData(await galleryFor(auth, req.signal), {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
});

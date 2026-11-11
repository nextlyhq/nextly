/**
 * GET `/api/dashboard/gallery`
 *
 * What the dashboard's add panel offers one reader, decided here, as that
 * reader, and only searched by the admin:
 *
 * - **tiles**, one per widget they may add or already have, in one list: by
 *   the layout read's own audience, conditions and offer (`galleryOffer`), then
 *   each declared widget's `access` and `shows` judged with the person, as a
 *   card of it would be (`defaultCardsNotShown`), so a widget they could never
 *   see is not offered;
 * - **collections**, the ones they may read that the dashboard shows (a
 *   collection internal, hidden from the navigation or removed from code has
 *   no content source, so it is never among them), in the sources' order: a
 *   new card that reads one starts on the first its widget has no card of.
 *
 * @module api/dashboard-gallery
 */

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import {
  inGalleryOrder,
  type GalleryCollection,
} from "../domains/widgets/add-panel";
import { sizeFacts, type CanonicalWidget } from "../domains/widgets/canonical";
import {
  CORE_OWNER,
  declaredWidget,
} from "../domains/widgets/declaration/declared-widgets";
import { SITE_CONFIG } from "../domains/widgets/declaration/site-component";
import type { WidgetSizeBounds } from "../domains/widgets/grid-size";
import type { WidgetPlacement } from "../domains/widgets/layout";
import { publishableContentSources } from "../domains/widgets/publish";
import { getWidget } from "../domains/widgets/registry";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { defaultCardsNotShown } from "./default-cards-shown";
import { respondData } from "./response-shapes";
import { galleryOffer, type GalleryOffer } from "./widget-layout";
import { withErrorHandler } from "./with-error-handler";

/** One widget as the gallery lists it. */
export interface GalleryTileItem {
  id: string;
  name: string;
  description?: string;
  /** The plugin that declared it, by its name; absent for core's and the site's. */
  plugin?: string;
  /** The sizes its cards may take, every end filled in. */
  size: WidgetSizeBounds;
  /** The Collection setting a card of it reads, by name; absent when it reads none. */
  collectionSetting?: string;
  allowsSeveral: boolean;
  /** Whether the reader may add a new card of it now. */
  offered: boolean;
  /** How many of its cards are on the reader's dashboard, removed ones not counted. */
  placed: number;
}

/** The gallery read's answer. */
export interface GalleryRead extends Record<string, unknown> {
  tiles: GalleryTileItem[];
  collections: GalleryCollection[];
}

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
 * The row for `widget`. `plugin` is the plugin that declared it, by its name, read before
 * `withPlugin` names an owner for the order.
 */
function tileOf(
  widget: CanonicalWidget,
  plugin: string | undefined,
  offer: GalleryOffer
): GalleryTileItem {
  const declared = declaredWidget(widget.id);
  const facts = sizeFacts(widget);
  return {
    id: widget.id,
    // The title the admin resolves too, from either channel, before the id.
    name:
      declared?.declaration.title ?? getWidget(widget.id)?.title ?? widget.id,
    ...(widget.description === undefined
      ? {}
      : { description: widget.description }),
    ...(plugin === undefined ? {} : { plugin }),
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

/** The gallery for one signed-in reader. */
async function galleryFor(
  auth: AuthContext,
  signal: AbortSignal
): Promise<GalleryRead> {
  const offer = await galleryOffer(auth, signal);
  const widgets = await tileWidgets(offer, signal);
  const ordered = inGalleryOrder(
    widgets.map(widget => ({
      ...withPlugin(widget),
      declaredBy: widget.plugin ?? declaredWidget(widget.id)?.plugin,
    }))
  );
  return {
    tiles: ordered.map(widget => tileOf(widget, widget.declaredBy, offer)),
    collections: readableCollections(offer),
  };
}

export const getDashboardGallery = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  return respondData(await galleryFor(auth, req.signal), {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
});

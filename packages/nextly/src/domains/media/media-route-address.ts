/**
 * The media item an address names through the media routes: the id after
 * `/media/` in `/api/media/<id>/raw`, `/admin/api/media/<id>`, or a copy's
 * `/api/media/<id>/copy/<width>`.
 *
 * One reading for everything that asks it: a document naming an item by its
 * route counts as using it (`usage/media-references`), and an address handed
 * to `copyOf` finds its item the same way. A change to which addresses name
 * an item reaches both at once.
 *
 * @module domains/media/media-route-address
 */

/** A media route naming an item by its id, anywhere in an address. */
const MEDIA_ROUTE =
  /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i;

/** The id of the media item `url` names by its route, or `undefined`. */
export function mediaIdOfRouteAddress(url: string): string | undefined {
  return MEDIA_ROUTE.exec(url)?.[1];
}

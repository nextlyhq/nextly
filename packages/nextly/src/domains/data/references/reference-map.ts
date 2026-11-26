/**
 * The references stored content holds, and the map that says what each one
 * becomes when an import gives an entry a new id or a media file a new
 * address.
 *
 * @module domains/data/references/reference-map
 */

/** The collection media items are stored in, and an upload's default. */
export const MEDIA_COLLECTION = "media";

/** A reference to an entry or a media item by its id. */
export interface LinkReference {
  kind: "link";
  /**
   * The field's name, after the names of the groups, repeaters and field
   * groups it sits in, joined by dots: `hero.image`, not `hero.0.image`.
   */
  fieldPath: string;
  /**
   * The collection the id is in: the one a polymorphic value names, else the
   * one the field points at (an upload with none points at media). `null`
   * when neither says, as for a field that may point at several collections
   * holding a value that does not name one.
   */
  collection: string | null;
  id: string;
  /**
   * Found as an id-shaped string in a block document that keeps no list of
   * the media it uses: most likely a media item's, but nothing declares it
   * one, so it is rewritten when the map has it and never reported missing.
   */
  inferred?: true;
}

/** A reference to a media file by its address. */
export interface AddressReference {
  kind: "address";
  fieldPath: string;
  url: string;
  /** The media item the address names by its route (`/api/media/<id>/…`). */
  mediaId?: string;
}

export type ContentReference = LinkReference | AddressReference;

/** What each reference becomes. A reference the map does not name is kept. */
export interface ReferenceMap {
  /** The new id, by collection and then by the id stored now. */
  readonly ids?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The new address, by the address stored now. */
  readonly addresses?: ReadonlyMap<string, string>;
}

/** The id that replaces `id` in `collection`, or `undefined` to keep it. */
export function mappedId(
  map: ReferenceMap,
  collection: string | null,
  id: string
): string | undefined {
  if (collection === null) return undefined;
  const next = map.ids?.get(collection)?.get(id);
  return next !== undefined && next !== id ? next : undefined;
}

/**
 * The address that replaces `url`, or `undefined` to keep it: the one the
 * map gives it, else, for an address naming a media item by its route, the
 * same route naming the item's new id.
 */
export function mappedAddress(
  map: ReferenceMap,
  url: string,
  mediaId?: string
): string | undefined {
  const direct = map.addresses?.get(url);
  if (direct !== undefined && direct !== url) return direct;
  if (mediaId === undefined) return undefined;
  const nextId = mappedId(map, MEDIA_COLLECTION, mediaId);
  if (nextId === undefined) return undefined;
  // Only the path names the item (`mediaIdOfRouteAddress`), so only the path
  // changes; a query or fragment is kept as it is.
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const route = new RegExp(`(/api/media/)${mediaId}(?=[/?#]|$)`, "i");
  return path.replace(route, `$1${nextId}`) + url.slice(path.length);
}

/** What `reference` becomes under `map`, or `undefined` to keep it. */
export function mappedReference(
  map: ReferenceMap,
  reference: ContentReference
): string | undefined {
  return reference.kind === "link"
    ? mappedId(map, reference.collection, reference.id)
    : mappedAddress(map, reference.url, reference.mediaId);
}

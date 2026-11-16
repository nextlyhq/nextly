/**
 * The fixed rules a resized copy of a stored image is made by.
 *
 * A copy has one of a fixed set of widths and one of a fixed set of formats,
 * and it is stored beside its original under a key derived from the
 * original's: `<original key>.w<width>.<ext>`. Nothing else is stored about
 * it, so finding, serving and deleting copies needs no record of them, and
 * nothing a request says can reach a storage key except through these sets.
 *
 * The widths are fixed so no caller can make the server resize without end:
 * every width is work and storage, and a request for any other width is
 * served the nearest one.
 *
 * @module domains/media/copies/copy-rules
 * @experimental
 */
import { createHash } from "node:crypto";

import { NextlyError } from "../../../errors/nextly-error";
import { canonicalMimeType } from "../../../services/upload-validation/mime";

/**
 * Every width a copy can have, in CSS pixels, narrowest first. The narrow
 * ones keep a small slot, a logo or an avatar, from being sent a photo-sized
 * image; the widest covers a full desktop slot at twice its density.
 *
 * @experimental
 */
export const MEDIA_COPY_WIDTHS = [
  96, 160, 240, 320, 640, 960, 1280, 1920,
] as const;

/** One of {@link MEDIA_COPY_WIDTHS}. @experimental */
export type MediaCopyWidth = (typeof MEDIA_COPY_WIDTHS)[number];

/**
 * The allowed width nearest to `width`. Of two equally near, the wider, so a
 * copy is never softer than asked for. Below the narrowest and above the
 * widest it is the narrowest and the widest.
 *
 * @throws NextlyError(VALIDATION_ERROR) for a width that is not a positive
 *   finite number, which no slot has.
 * @experimental
 */
export function nearestMediaCopyWidth(width: number): MediaCopyWidth {
  if (!Number.isFinite(width) || width <= 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "width",
          code: "INVALID_WIDTH",
          message: "A copy's width must be a positive number of pixels.",
        },
      ],
    });
  }
  let nearest: MediaCopyWidth = MEDIA_COPY_WIDTHS[0];
  for (const allowed of MEDIA_COPY_WIDTHS) {
    // `<=`, so a tie moves on to the wider of the two.
    if (Math.abs(allowed - width) <= Math.abs(nearest - width)) {
      nearest = allowed;
    }
  }
  return nearest;
}

/**
 * The width a route segment asks for, snapped, or `undefined` when the
 * segment is not plain digits. Read strictly, with no leading zero, sign,
 * exponent, space or suffix, so a segment that carries anything besides a
 * number is refused rather than half-read.
 */
export function parseCopyWidth(segment: string): MediaCopyWidth | undefined {
  // Up to six digits: wider than any screen, and short of anything a number
  // type would round.
  if (!/^[1-9]\d{0,5}$/.test(segment)) return undefined;
  return nearestMediaCopyWidth(Number(segment));
}

/** A format a copy can be stored and sent in. */
export interface CopyFormat {
  /** The extension its key ends with. */
  readonly ext: "avif" | "webp" | "jpg" | "png";
  /** The type it is sent as. */
  readonly mimeType: "image/avif" | "image/webp" | "image/jpeg" | "image/png";
}

const AVIF: CopyFormat = { ext: "avif", mimeType: "image/avif" };
const WEBP: CopyFormat = { ext: "webp", mimeType: "image/webp" };
const JPEG: CopyFormat = { ext: "jpg", mimeType: "image/jpeg" };
const PNG: CopyFormat = { ext: "png", mimeType: "image/png" };

/**
 * The formats a copy of each type of original can have, best first. JPEG and
 * PNG originals are also offered as AVIF and WebP, which carry the same
 * picture in far fewer bytes. WebP and AVIF originals keep their format. Any
 * other type has no copies: a GIF may be animated and an SVG already scales.
 */
const FORMATS_BY_TYPE: ReadonlyMap<string, readonly CopyFormat[]> = new Map([
  ["image/jpeg", [AVIF, WEBP, JPEG]],
  ["image/png", [AVIF, WEBP, PNG]],
  ["image/webp", [WEBP]],
  ["image/avif", [AVIF]],
]);

/** The formats an original of `mimeType` can be copied into; none if it has no copies. */
export function copyFormatsOf(mimeType: string): readonly CopyFormat[] {
  return FORMATS_BY_TYPE.get(canonicalMimeType(mimeType)) ?? [];
}

/**
 * The image types an `Accept` header names with a weight above zero. Only
 * types it names count: a browser sends `*\/*` and `image/*` whatever it can
 * decode, so a wildcard is no promise that it decodes AVIF or WebP.
 */
function namedImageTypes(accept: string | null): Set<string> {
  const named = new Set<string>();
  if (!accept) return named;
  for (const part of accept.split(",")) {
    const [range, ...params] = part.split(";").map(piece => piece.trim());
    const weight = params
      .map(param => /^q\s*=\s*([0-9.]+)$/i.exec(param)?.[1])
      .find(value => value !== undefined);
    if (weight !== undefined && !(Number(weight) > 0)) continue;
    named.add(range.toLowerCase());
  }
  return named;
}

/**
 * The format a browser sending `accept` is given a copy of an original of
 * `mimeType` in: the best of the original's formats it names, and otherwise
 * the original's own format, which every browser can show. `null` when the
 * original has no copies.
 */
export function negotiateCopyFormat(
  mimeType: string,
  accept: string | null
): CopyFormat | null {
  const formats = copyFormatsOf(mimeType);
  if (formats.length === 0) return null;
  const named = namedImageTypes(accept);
  // The last format is the original's own, or the one the original already
  // is: it needs no promise from the browser.
  const fallback = formats[formats.length - 1];
  return formats.find(format => named.has(format.mimeType)) ?? fallback;
}

/** The stored key of an original's copy at `width` in `format`. */
export function copyPathOf(
  originalPath: string,
  width: MediaCopyWidth,
  format: CopyFormat
): string {
  return `${originalPath}.w${width}.${format.ext}`;
}

/**
 * Every key a copy of this original can be stored at: each width in each of
 * its formats. Whether each one was ever made is not recorded, so a delete
 * removes them all, and a key never made counts as already removed.
 */
export function copyPathsOf(original: {
  filename: string;
  mimeType: string;
}): string[] {
  return copyFormatsOf(original.mimeType).flatMap(format =>
    MEDIA_COPY_WIDTHS.map(width => copyPathOf(original.filename, width, format))
  );
}

/**
 * A short fingerprint of the original's stored key. A replaced file gets a
 * new key, so the fingerprint changes with it, and an address carrying the
 * old one can be told apart from a current one.
 */
export function copyVersionOf(originalPath: string): string {
  return createHash("sha256").update(originalPath).digest("hex").slice(0, 12);
}

/**
 * Where the public media routes are mounted: the app's `api/media` route, as
 * every address naming a media item by id already assumes.
 */
const MEDIA_ROUTE_BASE = "/api/media";

/** The address a copy of `item` at `width` is asked for at. */
export function mediaCopyAddress(
  item: { id: string; filename: string },
  width: MediaCopyWidth
): string {
  return `${MEDIA_ROUTE_BASE}/${item.id}/copy/${width}?v=${copyVersionOf(item.filename)}`;
}

/** A media route naming an item by its id, anywhere in an address. */
const MEDIA_ROUTE =
  /\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i;

/**
 * The media item an address names through the media routes, or `undefined`.
 * Any other address, an image on another site or a file's own storage URL,
 * names no item a copy can be made of.
 */
export function mediaIdOfCopyableAddress(url: string): string | undefined {
  return MEDIA_ROUTE.exec(url)?.[1];
}

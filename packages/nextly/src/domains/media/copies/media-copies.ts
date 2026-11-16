/**
 * Resized copies of stored images, made when first asked for and kept beside
 * the original by the same storage.
 *
 * One implementation answers both questions about a copy: whether one can be
 * had and at what address (`copyOfMedia`, what the Direct API and plugins
 * read), and its bytes (`copyBytesOf`, what the copy route serves). Neither
 * knows who reads the result: whoever calls them has already decided the
 * caller may read the original, and a copy is never more readable than that.
 *
 * Where no copy can be had, the answer says so and the caller uses the
 * original: an image type that is not resized, a storage that cannot keep
 * copies, an install without the image library, an original past the pixel
 * limit, the read cap or its own width, an animated original, an original
 * missing from storage, or more copies asked for at once than are made
 * (`copy-turns`).
 *
 * @module domains/media/copies/media-copies
 * @experimental
 */
import { consoleLogger, type Logger } from "../../../shared/types";
import { DEFAULT_READ_MAX_BYTES } from "../../../storage/fetch-stored-bytes";
import type {
  ImageCopyFormat,
  ImageProcessor,
} from "../../../storage/image-processor";
import {
  keepsCopies,
  type CopyKeepingStorage,
} from "../../../storage/keeps-copies";
import { isStorageReadTooLarge } from "../../../storage/read-errors";
import {
  readStoredMediaBytes,
  type StoredMediaSource,
} from "../../../storage/read-stored-media";
import { getMediaStorage } from "../../../storage/storage";
import type { IStorageAdapter } from "../../../storage/types";
import { mediaIdOfRouteAddress } from "../media-route-address";

import {
  copyFormatsOf,
  copyPathOf,
  mediaCopyAddress,
  nearestMediaCopyWidth,
  negotiateCopyFormat,
  type CopyFormat,
  type MediaCopyWidth,
} from "./copy-rules";
import {
  copyInTurn,
  notAgainForAWhile,
  notTriedAgainYet,
  oneAtATimeFor,
} from "./copy-turns";

/**
 * A copy of a stored image, as a caller is told of it.
 *
 * @experimental
 */
export interface MediaCopy {
  /** The address the copy is served at. */
  url: string;
  /** Its width in pixels: the allowed width nearest the one asked for. */
  width: MediaCopyWidth;
}

/** What of a storage copies are read from, kept by and removed from. */
export type CopyStorage = StoredMediaSource &
  Pick<IStorageAdapter, "uploadAt"> &
  Partial<Pick<IStorageAdapter, "delete">>;

/** The collection whose storage holds media originals and their copies. */
const MEDIA_COLLECTION = "media";

/**
 * The storage media originals are kept in, and so their copies: the media
 * collection's own adapter, which reads and writes, rather than the manager
 * routing to it, which does neither.
 */
export function mediaCopyStorage(): CopyStorage {
  return getMediaStorage().getAdapterForCollection(MEDIA_COLLECTION);
}

/**
 * Which image a copy is asked of: a media item by its id, or an address. An
 * address finds an item only when it is one of this site's media routes
 * naming the item by id, as a path (`/api/media/<id>/raw`); any other
 * address, an image on another site above all, has no copy, and the caller
 * uses it as it is.
 *
 * @experimental
 */
export type MediaCopySource = { id: string } | { url: string };

/** The item id a copy source names, or `undefined` for an address naming none. */
export function mediaIdOfCopySource(
  source: MediaCopySource
): string | undefined {
  if ("id" in source) return source.id;
  // A full address may be on any host, and this site cannot tell its own
  // from another's, so only a path on this site names an item here.
  const onThisSite = source.url.startsWith("/") && !source.url.startsWith("//");
  return onThisSite ? mediaIdOfRouteAddress(source.url) : undefined;
}

/** What making and finding copies needs. */
export interface CopyDeps {
  storage: CopyStorage | null;
  processor: ImageProcessor;
  logger?: Logger;
  /**
   * Whether the item still has the original a copy was made from, asked once
   * the copy is kept. A copy finished after its original was deleted or
   * replaced is removed again, since no delete will find it afterwards.
   */
  stillCurrent?: () => Promise<boolean>;
}

/** The media item a copy is of, as far as a copy reads it. */
export interface CopySource {
  id: string;
  /** The original's stored key. */
  filename: string;
  mimeType: string;
  /** The original's width in pixels, when it is recorded. */
  width?: number | null;
}

/**
 * The allowed width nearest `width` that a copy of `item` can have, or `null`
 * past the original's own width. A copy is never enlarged, so one that wide
 * would be the original at its own size under a width it does not have, and
 * every width past it would be another key holding the same picture.
 */
function copyWidthOf(item: CopySource, width: number): MediaCopyWidth | null {
  const snapped = nearestMediaCopyWidth(width);
  // An original whose width was never recorded (uploaded while the image
  // library was missing) could be narrower than any width asked for, so no
  // width a copy would have can be promised.
  if (typeof item.width !== "number" || snapped > item.width) return null;
  return snapped;
}

/**
 * The copy of `item` nearest `width` wide, by its address, or `null` when no
 * copy can be had and the original is to be used, past the original's own
 * width among others.
 *
 * @experimental
 */
export async function copyOfMedia(
  item: CopySource,
  width: number,
  deps: CopyDeps
): Promise<MediaCopy | null> {
  const snapped = copyWidthOf(item, width);
  if (copyFormatsOf(item.mimeType).length === 0) return null;
  if (snapped === null) return null;
  if (!keepsCopies(deps.storage)) return null;
  if (!(await deps.processor.canProcess())) return null;
  return { url: mediaCopyAddress(item, snapped), width: snapped };
}

/** A copy's bytes, or word to serve the original instead. */
export type ServedCopy =
  | { kind: "copy"; bytes: Buffer; mimeType: CopyFormat["mimeType"] }
  | { kind: "original" };

const ORIGINAL: ServedCopy = { kind: "original" };

/** How each copy format is asked of the image library. */
const IMAGE_FORMAT: Record<CopyFormat["ext"], ImageCopyFormat> = {
  avif: "avif",
  webp: "webp",
  jpg: "jpeg",
  png: "png",
};

/**
 * The most bytes a kept copy is read up to, and so the largest copy kept:
 * twice the original's recorded size, with the default read cap beneath it.
 * A copy is narrower than its original, so it is nearly always smaller; one
 * past this is served once and not kept, so it is never kept beyond what can
 * be read back.
 */
function copyReadCap(item: { size: number }): number {
  return Math.max(DEFAULT_READ_MAX_BYTES, item.size * 2);
}

/**
 * Read `path` from storage, or `null` when it cannot be read now: missing,
 * past `cap`, or the storage failing. A failure is logged, and the caller
 * answers with the original rather than an error, so an image still shows.
 *
 * @param onTooLarge - Told when the file is past `cap`, which no later read
 *   of the same file changes.
 */
async function readOrNull(
  storage: KeepingStorage,
  path: string,
  cap: number,
  deps: CopyDeps,
  onTooLarge?: () => void
): Promise<Buffer | null> {
  try {
    return await readStoredMediaBytes(storage, path, cap);
  } catch (error) {
    if (isStorageReadTooLarge(error)) onTooLarge?.();
    (deps.logger ?? consoleLogger).warn("Could not read a stored image", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * What is remembered as not to be tried again for a while: one copy, whose
 * write failed or which came out past the read cap, or a whole original,
 * which could not be read within its cap or resized at all, so no copy of it
 * is tried in any width or format. Apart, so a copy's key that is also some
 * item's own file names one or the other.
 */
const copyMemoryKey = (key: string) => `copy:${key}`;
const originalMemoryKey = (filename: string) => `original:${filename}`;

/** A storage that can both read an original and keep a copy beside it. */
type KeepingStorage = CopyKeepingStorage<CopyStorage>;

/**
 * The bytes of `item`'s copy nearest `width` wide, in the best format the
 * browser sending `accept` names, made and kept if it is not kept yet.
 *
 * @param item - The original, as its record holds it, with its size, which
 *   bounds the read of its file.
 */
export async function copyBytesOf(
  item: CopySource & { size: number },
  width: number,
  accept: string | null,
  deps: CopyDeps
): Promise<ServedCopy> {
  const format = negotiateCopyFormat(item.mimeType, accept);
  const storage = deps.storage;
  if (format === null || !keepsCopies(storage)) return ORIGINAL;
  const snapped = copyWidthOf(item, width);
  if (snapped === null) return ORIGINAL;
  const key = copyPathOf(item.filename, snapped, format);

  // Read before anything remembered is asked: a copy kept by another
  // process, or by a write that failed only after it landed, is served.
  const kept = await readOrNull(storage, key, copyReadCap(item), deps);
  if (kept !== null) {
    return { kind: "copy", bytes: kept, mimeType: format.mimeType };
  }
  if (rememberedAsNoCopy(item, key)) return ORIGINAL;

  // A burst of asks for the same copy, as a page with one image in many
  // places makes on its first view, shares one resize. Past the bounds on
  // waiting, the ask is served the original rather than queued. Copies of
  // one original are made one after another, and each asks again, once its
  // turn comes, what the one before it may have learned or kept.
  const made = copyInTurn(key, () =>
    oneAtATimeFor(item.filename, async () => {
      if (rememberedAsNoCopy(item, key)) return ORIGINAL;
      const keptMeanwhile = await readOrNull(
        storage,
        key,
        copyReadCap(item),
        deps
      );
      if (keptMeanwhile !== null) {
        return {
          kind: "copy",
          bytes: keptMeanwhile,
          mimeType: format.mimeType,
        };
      }
      return await makeCopy(item, snapped, format, key, storage, deps);
    })
  );
  return made === undefined ? ORIGINAL : await made;
}

/**
 * Whether a copy, or its whole original, could not be kept or resized a
 * moment ago, and so is not tried again yet.
 */
function rememberedAsNoCopy(item: CopySource, key: string): boolean {
  return (
    notTriedAgainYet(copyMemoryKey(key)) ||
    notTriedAgainYet(originalMemoryKey(item.filename))
  );
}

/** Make one copy from the original, keep it, and hand back its bytes. */
async function makeCopy(
  item: CopySource & { size: number },
  width: MediaCopyWidth,
  format: CopyFormat,
  key: string,
  storage: KeepingStorage,
  deps: CopyDeps
): Promise<ServedCopy> {
  const logger = deps.logger ?? consoleLogger;
  // Bounded by the original's recorded size, with the default cap beneath it
  // for rows written before the size was taken from the stored bytes, as the
  // raw route reads.
  const original = await readOrNull(
    storage,
    item.filename,
    Math.max(DEFAULT_READ_MAX_BYTES, item.size),
    deps,
    () => notAgainForAWhile(originalMemoryKey(item.filename))
  );
  if (original === null) return ORIGINAL;

  const made = await deps.processor.copyAtWidth(
    original,
    width,
    IMAGE_FORMAT[format.ext]
  );
  if (made.kind !== "made") {
    // An original refused (animated, past the pixel limit, not an image) is
    // refused again in any width or format, so it is not read and tried for a
    // while. A missing image library is not remembered: installing it is
    // enough.
    if (made.kind === "refused") {
      notAgainForAWhile(originalMemoryKey(item.filename));
    }
    return ORIGINAL;
  }
  const served: ServedCopy = {
    kind: "copy",
    bytes: made.bytes,
    mimeType: format.mimeType,
  };
  // Too large to read back: served this once, not kept, and not made again
  // for a while, since it would come out as large.
  if (made.bytes.byteLength > copyReadCap(item)) {
    notAgainForAWhile(copyMemoryKey(key));
    return served;
  }

  try {
    await storage.uploadAt(key, made.bytes, { mimeType: format.mimeType });
  } catch (error) {
    // The copy is made, so this request is served it. The next asks are
    // served the original for a while, rather than each paying for a resize
    // a storage refusing writes would not keep either.
    notAgainForAWhile(copyMemoryKey(key));
    logger.warn("Could not keep a resized copy", {
      mediaId: item.id,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return served;
  }

  // The original may have been deleted or replaced while the copy was made,
  // and then no delete will ever list this key again.
  if (deps.stillCurrent && !(await deps.stillCurrent())) {
    await storage.delete?.(key).catch((error: unknown) => {
      logger.warn("Could not remove a copy of a removed original", {
        mediaId: item.id,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return served;
}

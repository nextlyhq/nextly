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
 * limit, or an original missing from storage.
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
import {
  readStoredMediaBytes,
  type StoredMediaSource,
} from "../../../storage/read-stored-media";
import { getMediaStorage } from "../../../storage/storage";
import type { IStorageAdapter } from "../../../storage/types";

import {
  copyFormatsOf,
  copyPathOf,
  mediaCopyAddress,
  mediaIdOfCopyableAddress,
  nearestMediaCopyWidth,
  negotiateCopyFormat,
  type CopyFormat,
  type MediaCopyWidth,
} from "./copy-rules";

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
 * address finds an item only when it is one of the media routes naming the
 * item by id; any other address, an image on another site above all, has no
 * copy, and the caller uses it as it is.
 *
 * @experimental
 */
export type MediaCopySource = { id: string } | { url: string };

/** The item id a copy source names, or `undefined` for an address naming none. */
export function mediaIdOfCopySource(
  source: MediaCopySource
): string | undefined {
  return "id" in source ? source.id : mediaIdOfCopyableAddress(source.url);
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
 * The copy of `item` nearest `width` wide, by its address, or `null` when no
 * copy can be had and the original is to be used. Also `null` past the
 * original's own width: a copy is never enlarged, so one that wide would be
 * the original at its own size, labelled with a width it does not have.
 *
 * @experimental
 */
export async function copyOfMedia(
  item: CopySource,
  width: number,
  deps: CopyDeps
): Promise<MediaCopy | null> {
  const snapped = nearestMediaCopyWidth(width);
  if (copyFormatsOf(item.mimeType).length === 0) return null;
  // An original whose width was never recorded (uploaded while the image
  // library was missing) could be narrower than any width asked for, and a
  // copy is never enlarged, so no width it would have can be promised.
  if (typeof item.width !== "number" || snapped > item.width) return null;
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
 * Copies being made now, by key. A burst of asks for the same copy, as a page
 * with one image in many places makes on its first view, shares one resize
 * rather than running the image library once per ask. Per process: a copy
 * made twice in two processes is the same bytes written twice.
 */
const inFlight = new Map<string, Promise<ServedCopy>>();

/**
 * How many copies one process makes at once. Decoding an original takes about
 * four bytes a pixel, so asks for many different copies at once, as a page of
 * new images or a caller walking the widths makes, wait their turn rather
 * than decode side by side.
 */
const MAKING_AT_ONCE = 2;
let making = 0;
const waiting: Array<() => void> = [];

/** Run `work` once fewer than {@link MAKING_AT_ONCE} copies are being made. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (making >= MAKING_AT_ONCE) {
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  making += 1;
  try {
    return await work();
  } finally {
    making -= 1;
    waiting.shift()?.();
  }
}

/**
 * Read `path` from storage, or `null` when it cannot be read now: missing,
 * past `cap`, or the storage failing. A failure is logged, and the caller
 * answers with the original rather than an error, so an image still shows.
 */
async function readOrNull(
  storage: KeepingStorage,
  path: string,
  cap: number,
  deps: CopyDeps
): Promise<Buffer | null> {
  try {
    return await readStoredMediaBytes(storage, path, cap);
  } catch (error) {
    (deps.logger ?? consoleLogger).warn("Could not read a stored image", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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
  const snapped = nearestMediaCopyWidth(width);
  const key = copyPathOf(item.filename, snapped, format);

  const kept = await readOrNull(storage, key, copyReadCap(item), deps);
  if (kept !== null) {
    return { kind: "copy", bytes: kept, mimeType: format.mimeType };
  }

  const running = inFlight.get(key);
  if (running) return await running;
  const made = inTurn(() =>
    makeCopy(item, snapped, format, key, storage, deps)
  ).finally(() => inFlight.delete(key));
  inFlight.set(key, made);
  return await made;
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
    deps
  );
  if (original === null) return ORIGINAL;

  const made = await deps.processor.copyAtWidth(
    original,
    width,
    IMAGE_FORMAT[format.ext]
  );
  if (made.kind !== "made") return ORIGINAL;
  const served: ServedCopy = {
    kind: "copy",
    bytes: made.bytes,
    mimeType: format.mimeType,
  };
  // Too large to read back: served this once, not kept.
  if (made.bytes.byteLength > copyReadCap(item)) return served;

  try {
    await storage.uploadAt(key, made.bytes, { mimeType: format.mimeType });
  } catch (error) {
    // The copy is made, so this request is served it; the next ask makes it
    // again. Logged, since a storage that keeps refusing makes every ask pay
    // for a resize.
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

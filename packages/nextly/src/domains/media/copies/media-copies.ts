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
import { DEFAULT_READ_MAX_BYTES } from "../../../storage/fetch-stored-bytes";
import type {
  ImageCopyFormat,
  ImageProcessor,
} from "../../../storage/image-processor";
import {
  readStoredMediaBytes,
  type StoredMediaSource,
} from "../../../storage/read-stored-media";
import type { IStorageAdapter } from "../../../storage/types";
import { consoleLogger, type Logger } from "../../../shared/types";

import {
  copyFormatsOf,
  copyPathOf,
  mediaCopyAddress,
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

/** What of a storage copies are read from and kept by. */
export type CopyStorage = StoredMediaSource & Pick<IStorageAdapter, "uploadAt">;

/** What making and finding copies needs. */
export interface CopyDeps {
  storage: CopyStorage | null;
  processor: ImageProcessor;
  logger?: Logger;
}

/** The media item a copy is of, as far as a copy reads it. */
export interface CopySource {
  id: string;
  /** The original's stored key. */
  filename: string;
  mimeType: string;
}

/** A storage that can both read an original and keep a copy beside it. */
type KeepingStorage = CopyStorage &
  Required<Pick<CopyStorage, "read" | "uploadAt">>;

/**
 * Whether `storage` can keep copies: it must read the original back and write
 * at a key of core's choosing. A storage that serves only by URL, or chooses
 * every key itself, cannot.
 */
function keepsCopies(
  storage: CopyStorage | null
): storage is KeepingStorage {
  return (
    storage !== null &&
    typeof storage.read === "function" &&
    typeof storage.uploadAt === "function"
  );
}

/**
 * The copy of `item` nearest `width` wide, by its address, or `null` when no
 * copy can be had and the original is to be used.
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
 * Copies being made now, by key. A burst of asks for the same copy, as a page
 * with one image in many places makes on its first view, shares one resize
 * rather than running the image library once per ask. Per process: a copy
 * made twice in two processes is the same bytes written twice.
 */
const inFlight = new Map<string, Promise<ServedCopy>>();

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

  const kept = await readStoredMediaBytes(storage, key, DEFAULT_READ_MAX_BYTES);
  if (kept !== null) {
    return { kind: "copy", bytes: kept, mimeType: format.mimeType };
  }

  const running = inFlight.get(key);
  if (running) return await running;
  const making = makeCopy(item, snapped, format, key, storage, deps).finally(
    () => inFlight.delete(key)
  );
  inFlight.set(key, making);
  return await making;
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
  // Bounded by the original's recorded size, with the default cap beneath it
  // for rows written before the size was taken from the stored bytes, as the
  // raw route reads.
  const original = await readStoredMediaBytes(
    storage,
    item.filename,
    Math.max(DEFAULT_READ_MAX_BYTES, item.size)
  );
  if (original === null) return ORIGINAL;

  const made = await deps.processor.copyAtWidth(
    original,
    width,
    IMAGE_FORMAT[format.ext]
  );
  if (made.kind !== "made") return ORIGINAL;

  try {
    await storage.uploadAt(key, made.bytes, { mimeType: format.mimeType });
  } catch (error) {
    // The copy is made, so this request is served it; the next ask makes it
    // again. Logged, since a storage that keeps refusing makes every ask pay
    // for a resize.
    (deps.logger ?? consoleLogger).warn("Could not keep a resized copy", {
      mediaId: item.id,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { kind: "copy", bytes: made.bytes, mimeType: format.mimeType };
}

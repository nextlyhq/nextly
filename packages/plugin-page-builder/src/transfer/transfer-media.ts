/**
 * A media file's bytes and their digest, as an export carries them and an
 * import compares them.
 *
 * The bytes come through the media collection's own storage adapter, as the
 * admin's raw media route reads them, so a file on local disk, in a bucket or
 * behind a CDN is read the same way. An adapter that cannot read is read at
 * the address its service issued for the file, which is only ever an
 * absolute one; a relative address names no host to ask.
 *
 * @module transfer/transfer-media
 */
import { createHash } from "node:crypto";

import { fetchStoredBytes, getMediaStorage } from "nextly/storage";

/** The collection media is stored under, which picks its adapter. */
const MEDIA_COLLECTION = "media";

/** A media record as the transfer routes read it. */
export interface StoredMediaRecord {
  readonly id: string;
  /** The stored object's name, which storage reads it by. */
  readonly filename: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly url: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
}

/** SHA-256 of some bytes, hex. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A media file's bytes, or `null` when its stored object is gone. Bounded by
 * the size the record states, which every write path records from the bytes
 * it wrote.
 */
export async function storedBytes(
  media: StoredMediaRecord
): Promise<Buffer | null> {
  const adapter = getMediaStorage().getAdapterForCollection(MEDIA_COLLECTION);
  const maxBytes = Math.max(media.size, 1);
  if (typeof adapter.read === "function") {
    return adapter.read(media.filename, { maxBytes });
  }
  if (!/^https?:\/\//i.test(media.url)) return null;
  return fetchStoredBytes(media.url, media.filename, adapter.getType(), {
    maxBytes,
  });
}

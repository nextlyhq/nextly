/**
 * Replace a media item's file, keeping the item.
 *
 * The new file is stored under a new address, with a new thumbnail, and the
 * item's row is pointed at it in one transaction with its `media.updated`
 * event: the same id, so every document using the item shows the new file at
 * once, and the same name (its extension following the new file), alt text,
 * caption, folder and usage. The focus point is cleared, since it marked a
 * spot on the old picture. The same transaction records the old files as
 * kept for the item, so they are never left unknown whatever follows. Once
 * that has committed, the old files are taken out of that record and
 * removed, except any another item still refers to, and except while
 * anything names the item by its address, when they are kept for it: a
 * document (`usage/address-uses`), or an avatar or a logo
 * (`media-address-holders`). Before `nextly media reindex-usage` has built
 * the usage record, which documents name the address is not known, so the
 * old files are kept then too. If the change does not commit, the new files
 * are removed instead.
 *
 * A new address rather than the old one overwritten: a CDN or an image cache
 * holding the old address would otherwise go on serving the old picture with
 * nothing the admin can do about it.
 *
 * @module domains/media/replace-media-file
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { actorForWrite, type RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import type { Logger } from "../../shared/types";
import { refusesUpload } from "../../storage/image-processor";
import type { UploadOptions, UploadResult } from "../../storage/types";
import { isImageMimeType, type Media } from "../../types/media";
import { recordMutationEvent } from "../webhooks/record-mutation-event";

import {
  errorForLog,
  filesKeptByOthers,
  removeStoredFiles,
  warnNotRemoved,
} from "./remove-stored-files";
import { revalidateMedia } from "./revalidate-media";
import { StoredFileSearchReader } from "./stored-file-search";
import { storedFilesOf } from "./stored-files";
import {
  forgetKeptFiles,
  recordKeptFiles,
  type ReplacedRecord,
} from "./usage/address-uses";
import {
  listIdentifiedMediaUsage,
  mediaUsagePresent,
  readWithinOneBuild,
} from "./usage/media-usage-store";

/** The new file, as the upload checks have passed it. */
export interface ReplacementFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  /** Set for a sanitized SVG served as an attachment, as an upload sets it. */
  contentDisposition?: "attachment";
}

/** What replacing needs: the database, the storage and the image tools. */
export interface ReplaceMediaFileDeps {
  adapter: DrizzleAdapter;
  storage: {
    upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;
    delete(filePath: string, collection?: string): Promise<void>;
  };
  images: {
    isValidImage(buffer: Buffer): Promise<"valid" | "invalid" | "unknown">;
    getDimensions(
      buffer: Buffer
    ): Promise<{ width: number; height: number } | null>;
    generateThumbnail(buffer: Buffer): Promise<{ buffer: Buffer } | null>;
  };
  logger: Logger;
  /**
   * How many records outside content (avatars, logos) keep an address,
   * as the `unused` view asks them.
   */
  addressHolders(address: string): Promise<number>;
}

/**
 * The item's name after its file is replaced: the same name, with the new
 * file's extension where the two differ, so a download is named for what it
 * holds.
 */
function nameAfterReplace(current: string, replacement: string): string {
  const extensionOf = (name: string): string => {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot) : "";
  };
  const next = extensionOf(replacement);
  const old = extensionOf(current);
  if (!next || next.toLowerCase() === old.toLowerCase()) return current;
  return `${old ? current.slice(0, -old.length) : current}${next}`;
}

/** The new file and its thumbnail, stored, with what the row records of them. */
interface StoredReplacement {
  changes: Record<string, unknown>;
  paths: string[];
}

/**
 * The new image's thumbnail, stored, or `null`. A thumbnail is derived and
 * never essential, so one that cannot be made leaves the file without one.
 */
async function storeThumbnail(
  deps: ReplaceMediaFileDeps,
  file: ReplacementFile
): Promise<UploadResult | null> {
  try {
    const thumbnail = await deps.images.generateThumbnail(file.buffer);
    if (!thumbnail) return null;
    return await deps.storage.upload(thumbnail.buffer, {
      filename: `thumb_${file.filename}`,
      mimeType: "image/jpeg",
      collection: "media",
    });
  } catch (error) {
    deps.logger.warn("[MediaService] Thumbnail generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Refuse a file that claims to be an image and is not one. */
async function refuseBrokenImage(
  deps: ReplaceMediaFileDeps,
  file: ReplacementFile
): Promise<void> {
  if (refusesUpload(await deps.images.isValidImage(file.buffer))) {
    throw NextlyError.validation({
      errors: [
        { path: "file", code: "INVALID", message: "Invalid image file." },
      ],
    });
  }
}

/** What the row records of the new file, once it is stored. */
function replacementChanges(
  current: Media,
  file: ReplacementFile,
  stored: UploadResult,
  thumbnail: UploadResult | null,
  dimensions: { width: number; height: number } | null
): Record<string, unknown> {
  return {
    filename: stored.path,
    originalFilename: nameAfterReplace(
      current.originalFilename || file.filename,
      file.filename
    ),
    mimeType: file.mimeType,
    size: file.buffer.length,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    url: stored.url,
    thumbnailUrl: thumbnail?.url ?? null,
    sizes: null,
    // An upload never derives a playing time, so the old file's goes with it.
    duration: null,
    focalX: null,
    focalY: null,
    updatedAt: new Date(),
  };
}

/** Store the new file and, for an image, its thumbnail. */
async function storeReplacement(
  deps: ReplaceMediaFileDeps,
  current: Media,
  file: ReplacementFile
): Promise<StoredReplacement> {
  const image = isImageMimeType(file.mimeType);
  if (image) await refuseBrokenImage(deps, file);
  const dimensions = image
    ? await deps.images.getDimensions(file.buffer)
    : null;
  const { contentDisposition } = file;
  const stored = await deps.storage.upload(file.buffer, {
    filename: file.filename,
    mimeType: file.mimeType,
    collection: "media",
    ...(contentDisposition ? { contentDisposition } : {}),
  });
  const thumbnail = image ? await storeThumbnail(deps, file) : null;
  return {
    paths: thumbnail ? [stored.path, thumbnail.path] : [stored.path],
    changes: replacementChanges(current, file, stored, thumbnail, dimensions),
  };
}

/** Remove files this replace stored, when the row was never pointed at them. */
async function removeNewFiles(
  deps: ReplaceMediaFileDeps,
  paths: readonly string[],
  mediaId: string
): Promise<void> {
  await Promise.all(
    paths.map(async path => {
      try {
        await deps.storage.delete(path, "media");
      } catch (error) {
        warnNotRemoved(path, mediaId, error);
      }
    })
  );
}

/**
 * Whether the files an item had before a Replace are kept whatever documents
 * say: until the usage table exists, when which documents name the address
 * is not recorded, and while an avatar or a logo names the address.
 */
async function keptOutsideTheRecord(
  deps: ReplaceMediaFileDeps,
  previous: Media
): Promise<boolean> {
  if (!(await mediaUsagePresent(deps.adapter, deps.logger))) return true;
  const held = previous.url ? await deps.addressHolders(previous.url) : 0;
  return held > 0;
}

/**
 * Whether a document may still name the item by an address, on `db`: while
 * any usage row names it by one (as the reference the content made says),
 * and, until the usage record has been built, always, since a document the
 * record does not cover yet may name it. The rows and whether their record
 * was built are one read (`readWithinOneBuild`), so a rebuild clearing the
 * rows while the record is read never passes for a complete record that
 * lists no use.
 */
async function namedByAddress(
  db: Pick<TransactionContext, "select">,
  mediaId: string
): Promise<boolean> {
  const { value: rows, recorded } = await readWithinOneBuild(db, () =>
    listIdentifiedMediaUsage(db, mediaId)
  );
  return !recorded || rows.some(row => row.address !== null);
}

/** The files `current` had that the replacement does not, by address. */
function oldFilesOf(
  current: Media,
  replacement: StoredReplacement
): ReplacedRecord["files"] {
  return storedFilesOf(current)
    .paths.filter(path => !replacement.paths.includes(path))
    .map(path => ({ path, url: current.url }));
}

/**
 * The old files, once the item points at its new ones: kept while anything
 * names the item by its address (rich text, an email template's image, an
 * avatar, a logo), which goes on naming the old file, or while the usage
 * record cannot yet say; otherwise taken out of the record and removed,
 * except any another item still refers to. Whether a document names the
 * address is asked in the transaction that takes them out of the record,
 * under the item's row lock (`forgetKeptFiles`), which a document's write
 * naming a kept address also takes: a use such a write records is either
 * seen there, keeping the files, or recorded once the address is forgotten,
 * when it names no item. The files go only once that has committed. The
 * Replace has committed, so nothing here fails it: a step that cannot finish
 * leaves the files kept and recorded as the item's, which its delete
 * removes, and is logged. Kept, too, when this cannot be asked: a file kept
 * is never a page broken.
 */
async function settleOldFiles(
  deps: ReplaceMediaFileDeps,
  mediaId: string,
  previous: Media,
  replacement: StoredReplacement
): Promise<void> {
  const files = oldFilesOf(previous, replacement);
  try {
    if (await keptOutsideTheRecord(deps, previous)) return;
    const kept = await filesKeptByOthers(
      new StoredFileSearchReader(deps.adapter, deps.logger).search,
      files.map(file => file.path),
      [mediaId]
    );
    if (!kept) return;
    const forgotten = await forgetKeptFiles(deps.adapter, mediaId, files, tx =>
      namedByAddress(tx, mediaId)
    );
    if (!forgotten) return;
    await removeStoredFiles(
      deps.storage,
      previous,
      mediaId,
      new Set([...kept, ...replacement.paths])
    );
  } catch (error) {
    deps.logger.warn("[MediaService] Replaced file kept", {
      mediaId,
      error: errorForLog(error),
    });
  }
}

/**
 * Replace the file of `mediaId` with `file`, answering the item as it now
 * is. Not found when the item does not exist, or is deleted meanwhile.
 */
export async function replaceMediaFile(
  deps: ReplaceMediaFileDeps,
  mediaId: string,
  file: ReplacementFile,
  actor?: RequestActor
): Promise<Media> {
  const where = { and: [{ column: "id", op: "=" as const, value: mediaId }] };
  const [before] = await deps.adapter.select<Media>("media", { where });
  if (!before) throw NextlyError.notFound({ logContext: { mediaId } });

  // Stored before the transaction opens, so slow storage never holds the
  // row's lock.
  const replacement = await storeReplacement(deps, before, file);

  let replaced: { previous: Media; next: Media } | null = null;
  try {
    replaced = await deps.adapter.transaction(async tx => {
      await tx.lockRow("media", mediaId);
      const [current] = await tx.select<Media>("media", { where });
      if (!current) return null;
      await tx.update("media", replacement.changes, where);
      const next = { ...current, ...replacement.changes };
      await recordMutationEvent(tx, {
        type: "media.updated",
        resource: { kind: "media", id: mediaId },
        data: next,
        previous: current,
        fields: [],
        actor: actorForWrite(actor, null),
      });
      // The old files are recorded as kept with the switch itself, so they
      // are known as the item's (and go when it does) whatever happens after
      // this commits; they are taken back out once nothing is found to name
      // them.
      await recordKeptFiles(tx, mediaId, oldFilesOf(current, replacement));
      return { previous: current, next };
    });
  } catch (error) {
    await removeNewFiles(deps, replacement.paths, mediaId);
    throw error;
  }
  if (!replaced) {
    await removeNewFiles(deps, replacement.paths, mediaId);
    throw NextlyError.notFound({ logContext: { mediaId } });
  }

  await revalidateMedia([mediaId], deps.logger);
  await settleOldFiles(deps, mediaId, replaced.previous, replacement);
  return replaced.next;
}

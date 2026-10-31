/**
 * Replace a media item's file, keeping the item.
 *
 * The new file is stored under a new address, with a new thumbnail, and the
 * item's row is pointed at it in one transaction with its `media.updated`
 * event: the same id, so every document using the item shows the new file at
 * once, and the same name (its extension following the new file), alt text,
 * caption, folder and usage. The focus point is cleared, since it marked a
 * spot on the old picture. Once that has committed, the old files are
 * removed, except any another item still refers to; if it does not commit,
 * the new files are removed instead.
 *
 * A new address rather than the old one overwritten: a CDN or an image cache
 * holding the old address would otherwise go on serving the old picture with
 * nothing the admin can do about it.
 *
 * @module domains/media/replace-media-file
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { actorForWrite, type RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import type { Logger } from "../../shared/types";
import { refusesUpload } from "../../storage/image-processor";
import type { UploadOptions, UploadResult } from "../../storage/types";
import { isImageMimeType, type Media } from "../../types/media";
import { recordMutationEvent } from "../webhooks/record-mutation-event";

import {
  filesKeptByOthers,
  removeStoredFiles,
  warnNotRemoved,
} from "./remove-stored-files";
import { revalidateMedia } from "./revalidate-media";
import { StoredFileSearchReader } from "./stored-file-search";
import { storedFilesOf } from "./stored-files";

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

/** Store the new file and, for an image, its thumbnail. */
async function storeReplacement(
  deps: ReplaceMediaFileDeps,
  current: Media,
  file: ReplacementFile
): Promise<StoredReplacement> {
  const image = isImageMimeType(file.mimeType);
  if (image && refusesUpload(await deps.images.isValidImage(file.buffer))) {
    throw NextlyError.validation({
      errors: [
        { path: "file", code: "INVALID", message: "Invalid image file." },
      ],
    });
  }
  const dimensions = image
    ? await deps.images.getDimensions(file.buffer)
    : null;
  const stored = await deps.storage.upload(file.buffer, {
    filename: file.filename,
    mimeType: file.mimeType,
    collection: "media",
    ...(file.contentDisposition
      ? { contentDisposition: file.contentDisposition }
      : {}),
  });
  const thumbnail = image ? await storeThumbnail(deps, file) : null;
  const paths = thumbnail ? [stored.path, thumbnail.path] : [stored.path];
  return {
    paths,
    changes: {
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
      focalX: null,
      focalY: null,
      updatedAt: new Date(),
    },
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

  // The old files, now that nothing in this item refers to them, except any
  // another item still does.
  const { previous, next } = replaced;
  const oldPaths = storedFilesOf(previous).paths.filter(
    path => !replacement.paths.includes(path)
  );
  const kept = await filesKeptByOthers(
    new StoredFileSearchReader(deps.adapter, deps.logger).search,
    oldPaths,
    [mediaId]
  );
  if (kept) {
    await removeStoredFiles(
      deps.storage,
      previous,
      mediaId,
      new Set([...kept, ...replacement.paths])
    );
  }
  return next;
}

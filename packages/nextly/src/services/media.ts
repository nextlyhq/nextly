/**
 * Media Service
 *
 * Handles CRUD operations for media files with integrated storage and image processing
 *
 * Features:
 * - Auto-detects storage (Vercel Blob, S3, R2, or local filesystem)
 * - Automatic thumbnail generation for images
 * - Image optimization (compression, WebP conversion)
 * - Pagination, search, filtering, sorting
 * - File validation and error handling
 * - Retry logic with exponential backoff for transient storage failures
 *
 * @example
 * ```typescript
 * const mediaService = new MediaService(adapter, logger);
 *
 * // Upload image
 * const result = await mediaService.uploadMedia({
 *   file: buffer,
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 *   size: 1024000,
 *   uploadedBy: userId,
 * });
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, count, desc, asc, or, sql } from "drizzle-orm";

import {
  getMediaStorage,
  getImageProcessor,
  withRetry,
  isTransientError,
  generateImageSizes,
  deleteImageSizes,
} from "@nextly/storage";

// Actor threading + outbox recording for media writes. Each write records a
// durable `media.*` event in the same transaction as the row change.
import { actorForWrite, type RequestActor } from "../auth/request-actor";
import { recordMutationEvent } from "../domains/webhooks/record-mutation-event";
import { keysToSnakeCase } from "../lib/case-conversion";
import { isImageMimeType, validateFileSize } from "../types/media";
import type {
  Media,
  MediaParams,
  MediaListResponse,
  MediaResponse,
  DeleteMediaResponse,
  UploadMediaInput,
  UpdateMediaInput,
} from "../types/media";

import { BaseService } from "./base-service";
import { ImageSizeService } from "./image-size";
import type { Logger } from "./shared";

export class MediaService extends BaseService {
  // Lazy-initialized to avoid capturing a stale MediaStorage singleton
  // before storage plugins are registered via registerServices()
  private get storage() {
    return getMediaStorage();
  }
  private get imageProcessor() {
    return getImageProcessor();
  }

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * List media with pagination, search, filtering, and sorting
   */
  async listMedia(params?: MediaParams): Promise<MediaListResponse> {
    try {
      const {
        page = 1,
        limit = 24,
        search,
        type,
        folderId,
        sortBy = "uploadedAt",
        sortOrder = "desc",
      } = params || {};

      const { media } = this.tables;

      const conditions = [];

      if (folderId !== undefined) {
        if (folderId === null || folderId === "root") {
          conditions.push(sql`${media.folderId} IS NULL`);
        } else {
          conditions.push(sql`${media.folderId} = ${folderId}`);
        }
      }

      // Using LOWER() for case-insensitive search across all databases
      if (search) {
        const searchLower = search.toLowerCase();
        conditions.push(
          or(
            sql`LOWER(${media.filename}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${media.originalFilename}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${media.altText}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${media.caption}) LIKE ${`%${searchLower}%`}`
          )
        );
      }

      if (type) {
        conditions.push(sql`${media.mimeType} LIKE ${`${type}/%`}`);
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const orderFn = sortOrder === "asc" ? asc : desc;
      const orderByClause = orderFn(media[sortBy]);

      const offset = (page - 1) * limit;

      const countResult = await this.db
        .select({ value: count() })
        .from(media)
        .where(whereClause);
      const total = Number(countResult[0]?.value ?? 0);

      let query = this.db.select().from(media);

      if (whereClause) {
        query = query.where(whereClause);
      }

      const results = await query
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        statusCode: 200,
        message: `Found ${results.length} media file(s)`,
        data: results as Media[],
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
      };
    } catch (error) {
      console.error("[MediaService] List media error:", error);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to fetch media",
        data: null,
      };
    }
  }

  /**
   * Get media by ID
   */
  async getMediaById(mediaId: string): Promise<MediaResponse> {
    try {
      const { media } = this.tables;

      const result = await this.db
        .select()
        .from(media)
        .where(sql`${media.id} = ${mediaId}`)
        .limit(1);

      if (result.length === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Media not found",
          data: null,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "Media retrieved successfully",
        data: result[0] as Media,
      };
    } catch (error) {
      console.error("[MediaService] Get media error:", error);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to retrieve media",
        data: null,
      };
    }
  }

  /**
   * Upload media file with automatic processing and storage
   */
  async uploadMedia(
    input: UploadMediaInput,
    actor?: RequestActor
  ): Promise<MediaResponse> {
    try {
      const {
        file,
        filename,
        mimeType,
        size,
        uploadedBy,
        folderId,
        contentDisposition,
      } = input;

      const sizeValidation = validateFileSize(size);
      if (!sizeValidation.valid) {
        return {
          success: false,
          statusCode: 400,
          message: sizeValidation.error || "Invalid file size",
          data: null,
        };
      }

      const isImage = isImageMimeType(mimeType);
      let width: number | null = null;
      let height: number | null = null;
      let thumbnailUrl: string | null = null;

      if (isImage) {
        const isValid = await this.imageProcessor.isValidImage(file);
        if (!isValid) {
          return {
            success: false,
            statusCode: 400,
            message: "Invalid image file",
            data: null,
          };
        }

        const dimensions = await this.imageProcessor.getDimensions(file);
        if (dimensions) {
          width = dimensions.width;
          height = dimensions.height;
        }

        try {
          const thumbnail = await this.imageProcessor.generateThumbnail(file);
          const thumbnailFilename = `thumb_${filename}`;
          const thumbnailResult = await withRetry(
            () =>
              this.storage.upload(thumbnail.buffer, {
                filename: thumbnailFilename,
                mimeType: "image/jpeg",
                collection: "media",
              }),
            {
              maxAttempts: 3,
              baseDelayMs: 500,
              shouldRetry: isTransientError,
              onRetry: (err, attempt) => {
                console.warn(
                  `[MediaService] Thumbnail upload retry ${attempt}:`,
                  err instanceof Error ? err.message : err
                );
              },
            }
          );
          thumbnailUrl = thumbnailResult.url;
        } catch (error) {
          console.warn("[MediaService] Thumbnail generation failed:", error);
          // Continue without thumbnail
        }
      }

      const uploadResult = await withRetry(
        () =>
          this.storage.upload(file, {
            filename,
            mimeType,
            collection: "media",
            // Forward when set; storage adapters that don't honor
            // per-object disposition silently no-op (storage-local) or
            // refuse the upload entirely (storage-vercel-blob).
            ...(contentDisposition && { contentDisposition }),
          }),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          shouldRetry: isTransientError,
          onRetry: (err, attempt) => {
            console.warn(
              `[MediaService] Upload retry ${attempt}:`,
              err instanceof Error ? err.message : err
            );
          },
        }
      );

      let sizesData: Record<string, unknown> | null = null;
      if (isImage) {
        try {
          const imageSizeService = new ImageSizeService(
            this.adapter,
            this.logger
          );
          const sizeConfigs = await imageSizeService.getActiveSizeConfigs();

          if (sizeConfigs.length > 0) {
            const uploadFn = async (
              buffer: Buffer,
              opts: {
                filename: string;
                mimeType: string;
                folder?: string;
                collection?: string;
              }
            ) => {
              return this.storage.upload(buffer, {
                filename: opts.filename,
                mimeType: opts.mimeType,
                collection: "media",
              });
            };

            sizesData = await generateImageSizes(
              file,
              filename,
              sizeConfigs,
              uploadFn
            );

            // Use the thumbnail from named sizes if available (backward compat)
            if (sizesData && "thumbnail" in sizesData) {
              const thumbVariant = sizesData.thumbnail as { url: string };
              thumbnailUrl = thumbnailUrl ?? thumbVariant.url;
            }
          }
        } catch (error) {
          console.warn("[MediaService] Image size generation failed:", error);
          // Continue without sizes - not a critical failure
        }
      }

      const now = new Date();
      const mediaId = crypto.randomUUID();

      const mediaRecord = {
        id: mediaId,
        filename: uploadResult.path,
        originalFilename: filename,
        mimeType,
        size,
        width,
        height,
        duration: null,
        url: uploadResult.url,
        thumbnailUrl,
        altText: null,
        caption: null,
        tags: null,
        focalX: null,
        focalY: null,
        sizes: sizesData ?? null,
        folderId: folderId ?? null,
        uploadedBy,
        uploadedAt: now,
        updatedAt: now,
      };

      // Persist the row and record the outbox event in one transaction so the
      // event is durable exactly when the insert commits, and never for a write
      // that later rolls back. The positional adapter transaction is required
      // because recordMutationEvent writes through the adapter's
      // TransactionContext, not the Drizzle fluent transaction. `sizes` is
      // serialized to a JSON string up front: the positional insert binds
      // values through the raw driver, which cannot bind a plain object for the
      // json/jsonb/text `sizes` column consistently across all three dialects.
      const insertRow = keysToSnakeCase({
        ...mediaRecord,
        sizes: sizesData == null ? null : JSON.stringify(sizesData),
      }) as Record<string, unknown>;

      await this.adapter.transaction(async tx => {
        await tx.insert("media", insertRow, { returning: [] });

        // `data` is the just-created row in read shape; a fresh upload has no
        // prior state, so `previous` is null. Media has no field schema, so
        // `fields` is empty (nothing to strip). The uploader is the recorded
        // subject when no transport actor was threaded.
        await recordMutationEvent(tx, {
          type: "media.uploaded",
          resource: { kind: "media", id: mediaId },
          data: mediaRecord,
          previous: null,
          fields: [],
          actor: actorForWrite(actor, uploadedBy ? { id: uploadedBy } : null),
        });
      });

      return {
        success: true,
        statusCode: 201,
        message: "Media uploaded successfully",
        data: mediaRecord as unknown as Media,
      };
    } catch (error) {
      console.error("[MediaService] Upload media error:", error);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to upload media",
        data: null,
      };
    }
  }

  /**
   * Update media metadata (altText, caption, tags)
   */
  async updateMedia(
    mediaId: string,
    changes: UpdateMediaInput,
    actor?: RequestActor
  ): Promise<MediaResponse> {
    try {
      const existing = await this.getMediaById(mediaId);
      if (!existing.success) {
        return existing;
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (changes.altText !== undefined) updateData.altText = changes.altText;
      if (changes.caption !== undefined) updateData.caption = changes.caption;
      if (changes.tags !== undefined) updateData.tags = changes.tags;
      if (changes.focalX !== undefined) updateData.focalX = changes.focalX;
      if (changes.focalY !== undefined) updateData.focalY = changes.focalY;

      // If crop point changed and media is an image, regenerate sizes immediately
      const focalPointChanged =
        changes.focalX !== undefined || changes.focalY !== undefined;
      const mediaData = existing.data!;

      if (focalPointChanged && isImageMimeType(mediaData.mimeType)) {
        const adapter = this.storage.getAdapterForCollection("media");
        if (adapter.read) {
          try {
            const originalBuffer = await adapter.read(mediaData.filename);
            if (originalBuffer) {
              const imageSizeService = new ImageSizeService(
                this.adapter,
                this.logger
              );
              const sizeConfigs = await imageSizeService.getActiveSizeConfigs();

              if (sizeConfigs.length > 0) {
                const oldSizes = (
                  mediaData as unknown as Record<string, unknown>
                ).sizes;
                if (oldSizes) {
                  const parsed =
                    typeof oldSizes === "string"
                      ? JSON.parse(oldSizes)
                      : oldSizes;
                  await deleteImageSizes(parsed, path =>
                    this.storage.delete(path, "media")
                  );
                }

                const uploadFn = async (
                  buffer: Buffer,
                  opts: { filename: string; mimeType: string }
                ) => {
                  return this.storage.upload(buffer, {
                    filename: opts.filename,
                    mimeType: opts.mimeType,
                    collection: "media",
                  });
                };
                const newSizes = await generateImageSizes(
                  originalBuffer,
                  mediaData.originalFilename || mediaData.filename,
                  sizeConfigs,
                  uploadFn,
                  { focalX: changes.focalX, focalY: changes.focalY }
                );

                updateData.sizes = newSizes;

                if (newSizes && "thumbnail" in newSizes) {
                  updateData.thumbnailUrl = (
                    newSizes.thumbnail as unknown as { url: string }
                  ).url;
                }

                console.log(
                  `[MediaService] Regenerated ${Object.keys(newSizes).length} sizes for media ${mediaId}`
                );
              }
            }
          } catch (error) {
            console.warn(
              "[MediaService] Crop point size regeneration failed:",
              error
            );
            // Continue without regeneration - crop point is still saved
          }
        } else {
          console.log(
            `[MediaService] Crop point saved for media ${mediaId}. ` +
              `Size regeneration requires local storage or adapter with read support.`
          );
        }
      }

      // Commit the row update and its outbox event in one transaction so the
      // event is durable exactly when the change commits. The row is locked and
      // RE-READ inside the transaction (not reused from the pre-transaction
      // read): the fresh read reflects the latest committed state, so a row
      // removed by a concurrent delete is detected reliably on every dialect
      // (a bare update-then-select-back can return a stale snapshot row on
      // MySQL's repeatable read), and a field another request committed after
      // our first read is not shipped stale. The transaction returns the
      // post-update document (or null when the row is already gone).
      const updatedRow = await this.adapter.transaction<Media | null>(
        async tx => {
          await tx.lockRow("media", mediaId);
          const currentRows = await tx.select<Media>("media", {
            where: this.whereEq("id", mediaId),
          });
          const current = currentRows[0];
          // Lost an update race: the row was deleted after our first read, so
          // record nothing and let the not-found result below stand.
          if (!current) {
            return null;
          }

          await tx.update("media", updateData, this.whereEq("id", mediaId));

          // The post-update document: the freshly-read committed row overlaid
          // with ONLY this write's columns (`updateData` holds each supplied
          // change plus any regenerated sizes/thumbnail and the fresh
          // updatedAt, keyed in the same camelCase as the read row). Reused as
          // both the event `data` and the response body so they never drift.
          const nextRow: Media = { ...current, ...updateData };

          // `previous` is the freshly-read pre-write row; `data` is the new
          // state. Media has no field schema, so `fields` is empty.
          await recordMutationEvent(tx, {
            type: "media.updated",
            resource: { kind: "media", id: mediaId },
            data: nextRow,
            previous: current,
            fields: [],
            actor: actorForWrite(actor, null),
          });

          return nextRow;
        }
      );

      if (!updatedRow) {
        // Mirror getMediaById's not-found shape so the domain layer maps this to
        // a 404 instead of treating the no-op write as a successful update.
        return {
          success: false,
          statusCode: 404,
          message: "Media not found",
          data: null,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "Media updated successfully",
        data: updatedRow,
      };
    } catch (error) {
      console.error("[MediaService] Update media error:", error);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to update media",
        data: null,
      };
    }
  }

  /**
   * Delete media file (removes from storage and database)
   */
  async deleteMedia(
    mediaId: string,
    actor?: RequestActor
  ): Promise<DeleteMediaResponse> {
    try {
      const existing = await this.getMediaById(mediaId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          statusCode: 404,
          message: "Media not found",
        };
      }

      // Remove the row and record the outbox event in one transaction FIRST,
      // before touching physical storage. The database is the source of truth,
      // so the row deletion and its durable event commit together; storage
      // cleanup runs afterward. If that cleanup fails it leaves an orphaned FILE
      // (benign, later reclaimable) rather than a surviving ROW pointing at an
      // already-deleted file (a real read bug). The row is locked and RE-READ
      // inside the transaction so a row already removed by a concurrent request
      // is detected reliably on every dialect, and the event's `data` carries
      // the latest committed state rather than the pre-transaction read. The
      // transaction returns the deleted row (or null when it was already gone).
      const deletedRow = await this.adapter.transaction<Media | null>(
        async tx => {
          await tx.lockRow("media", mediaId);
          const currentRows = await tx.select<Media>("media", {
            where: this.whereEq("id", mediaId),
          });
          const current = currentRows[0];
          // Lost a delete race: the row is already gone, so record nothing.
          // Only the request that actually removes the row emits media.deleted.
          if (!current) {
            return null;
          }

          await tx.delete("media", this.whereEq("id", mediaId));

          // The removed row's final state ships as `data`; there is no
          // post-delete state, so `previous` is null (mirroring create). Media
          // has no field schema, so `fields` is empty (nothing to strip).
          await recordMutationEvent(tx, {
            type: "media.deleted",
            resource: { kind: "media", id: mediaId },
            data: current,
            previous: null,
            fields: [],
            actor: actorForWrite(actor, null),
          });

          return current;
        }
      );

      // The row was gone before we could delete it: report not-found and skip
      // physical cleanup (the winning request owns the file) rather than
      // returning a false success for a no-op delete.
      if (!deletedRow) {
        return {
          success: false,
          statusCode: 404,
          message: "Media not found",
        };
      }
      const mediaData = deletedRow;

      // Best-effort physical cleanup AFTER the row + event have committed.
      // Swallow-and-warn: a storage failure must not fail a delete whose
      // authoritative row removal already succeeded.
      try {
        await withRetry(
          () => this.storage.delete(mediaData.filename, "media"),
          {
            maxAttempts: 3,
            baseDelayMs: 500,
            shouldRetry: isTransientError,
            onRetry: (err, attempt) => {
              console.warn(
                `[MediaService] Delete retry ${attempt}:`,
                err instanceof Error ? err.message : err
              );
            },
          }
        );

        if (mediaData.thumbnailUrl) {
          const thumbPath = mediaData.thumbnailUrl.split("/").pop();
          if (thumbPath) {
            await withRetry(() => this.storage.delete(thumbPath, "media"), {
              maxAttempts: 2,
              baseDelayMs: 500,
              shouldRetry: isTransientError,
            });
          }
        }

        const sizes = (mediaData as unknown as Record<string, unknown>).sizes;
        if (sizes) {
          const parsedSizes =
            typeof sizes === "string" ? JSON.parse(sizes) : sizes;
          await deleteImageSizes(parsedSizes, path =>
            this.storage.delete(path, "media")
          );
        }
      } catch (error) {
        console.warn("[MediaService] Storage deletion warning:", error);
        // Storage cleanup is best-effort; the row and event are already gone.
      }

      return {
        success: true,
        statusCode: 200,
        message: "Media deleted successfully",
      };
    } catch (error) {
      console.error("[MediaService] Delete media error:", error);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to delete media",
      };
    }
  }

  /**
   * Upload multiple media files in parallel (with concurrency limit)
   *
   * Uploads files in batches of 5 concurrent uploads to avoid overwhelming
   * the server while still providing good performance.
   *
   * @param inputs - Array of files to upload
   * @returns Object with success status and individual results for each file
   *
   * @example
   * ```typescript
   * const result = await mediaService.uploadMediaBulk([
   *   { file: buffer1, filename: 'photo1.jpg', mimeType: 'image/jpeg', size: 1024, uploadedBy: userId },
   *   { file: buffer2, filename: 'photo2.jpg', mimeType: 'image/jpeg', size: 2048, uploadedBy: userId },
   * ]);
   *
   * console.log(`Uploaded ${result.results.filter(r => r.success).length} of ${result.results.length} files`);
   * result.results.forEach(r => {
   *   if (r.success) {
   *     console.log(`✓ ${r.filename}`);
   *   } else {
   *     console.log(`✗ ${r.filename}: ${r.error}`);
   *   }
   * });
   * ```
   */
  async uploadMediaBulk(inputs: UploadMediaInput[]): Promise<{
    success: boolean;
    totalFiles: number;
    successCount: number;
    failureCount: number;
    results: Array<{
      filename: string;
      success: boolean;
      data?: Media;
      error?: string;
      statusCode?: number;
    }>;
  }> {
    const results: Array<{
      filename: string;
      success: boolean;
      data?: Media;
      error?: string;
      statusCode?: number;
    }> = [];

    const CHUNK_SIZE = 5;
    const chunks: UploadMediaInput[][] = [];

    for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
      chunks.push(inputs.slice(i, i + CHUNK_SIZE));
    }

    // Process each chunk sequentially, but files within chunk in parallel
    for (const chunk of chunks) {
      const promises = chunk.map(async input => {
        try {
          const result = await this.uploadMedia(input);
          return {
            filename: input.filename,
            success: result.success,
            data: result.data || undefined,
            error: result.success ? undefined : result.message,
            statusCode: result.statusCode,
          };
        } catch (error) {
          return {
            filename: input.filename,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            statusCode: 500,
          };
        }
      });

      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return {
      success: successCount > 0,
      totalFiles: inputs.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Delete multiple media files in parallel
   *
   * @param mediaIds - Array of media IDs to delete
   * @returns Object with success status and individual results
   */
  async deleteMediaBulk(mediaIds: string[]): Promise<{
    success: boolean;
    totalFiles: number;
    successCount: number;
    failureCount: number;
    results: Array<{
      mediaId: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    const results: Array<{
      mediaId: string;
      success: boolean;
      error?: string;
    }> = [];

    const CHUNK_SIZE = 10;
    const chunks: string[][] = [];

    for (let i = 0; i < mediaIds.length; i += CHUNK_SIZE) {
      chunks.push(mediaIds.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async mediaId => {
        try {
          const result = await this.deleteMedia(mediaId);
          return {
            mediaId,
            success: result.success,
            error: result.success ? undefined : result.message,
          };
        } catch (error) {
          return {
            mediaId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return {
      success: successCount > 0,
      totalFiles: mediaIds.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Get storage type being used
   */
  getStorageType(): string {
    return this.storage.getStorageType();
  }
}

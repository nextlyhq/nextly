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

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, count, desc, asc, or, eq, sql } from "drizzle-orm";

import {
  getMediaStorage,
  getImageProcessor,
  withRetry,
  isTransientError,
  generateImageSizes,
  deleteImageSizes,
} from "@nextly/storage";

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
        pageSize = 24,
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

      const offset = (page - 1) * pageSize;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countResult = await (this.db as any)
        .select({ value: count() })
        .from(media)
        .where(whereClause);
      const total = Number(countResult[0]?.value ?? 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (this.db as any).select().from(media);

      if (whereClause) {
        query = query.where(whereClause);
      }

      const results = await query
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset);

      const totalPages = Math.ceil(total / pageSize);

      return {
        success: true,
        statusCode: 200,
        message: `Found ${results.length} media file(s)`,
        data: results as Media[],
        meta: {
          total,
          page,
          pageSize,
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.db as any)
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
  async uploadMedia(input: UploadMediaInput): Promise<MediaResponse> {
    try {
      const { file, filename, mimeType, size, uploadedBy, folderId } = input;

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

      const { media } = this.tables;
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

      await (this.db as any).insert(media).values(mediaRecord);

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
    changes: UpdateMediaInput
  ): Promise<MediaResponse> {
    try {
      const { media } = this.tables;

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
                const oldSizes = (mediaData as any).sizes;
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
                  updateData.thumbnailUrl = (newSizes.thumbnail as any).url;
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

      await (this.db as any)
        .update(media)
        .set(updateData)
        .where(eq(media.id, mediaId));

      return {
        success: true,
        statusCode: 200,
        message: "Media updated successfully",
        data: {
          ...mediaData,
          ...changes,
          ...updateData,
          updatedAt: updateData.updatedAt,
        } as Media,
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
  async deleteMedia(mediaId: string): Promise<DeleteMediaResponse> {
    try {
      const { media } = this.tables;

      const existing = await this.getMediaById(mediaId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          statusCode: 404,
          message: "Media not found",
        };
      }

      const mediaData = existing.data;

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

        const sizes = (mediaData as any).sizes;
        if (sizes) {
          const parsedSizes =
            typeof sizes === "string" ? JSON.parse(sizes) : sizes;
          await deleteImageSizes(parsedSizes, path =>
            this.storage.delete(path, "media")
          );
        }
      } catch (error) {
        console.warn("[MediaService] Storage deletion warning:", error);
        // Continue with database deletion even if storage fails
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any).delete(media).where(sql`${media.id} = ${mediaId}`);

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

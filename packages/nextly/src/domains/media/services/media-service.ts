/**
 * MediaService - Unified service for media file and folder operations
 *
 * This service provides a clean API for both media file operations (upload, delete, etc.)
 * and folder management (create, organize, move files). It follows the new service layer
 * architecture with:
 *
 * - Exception-based error handling using NextlyError
 * - RequestContext for user/locale context
 * - PaginatedResult for list operations
 * - Constructor injection for storage and image processor
 *
 * Internally delegates to the legacy MediaService and MediaFolderService for the actual
 * implementation, converting their result-shape return format to throw-based NextlyError.
 *
 * @example
 * ```typescript
 * import { MediaService, NextlyError } from '@revnixhq/nextly';
 *
 * const service = new MediaService(legacyMediaService, legacyFolderService, storage, imageProcessor);
 *
 * // Upload a file
 * const file = await service.upload({
 *   buffer: fileBuffer,
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 *   size: 1024000,
 * }, context);
 *
 * // Create a folder
 * const folder = await service.createFolder({ name: 'Photos' }, context);
 *
 * // Move file to folder
 * await service.moveToFolder(file.id, folder.id, context);
 *
 * // Error handling
 * try {
 *   const media = await service.findById('nonexistent', context);
 * } catch (error) {
 *   if (NextlyError.isNotFound(error)) {
 *     console.log(error.code); // 'NOT_FOUND'
 *     console.log(error.statusCode); // 404
 *   }
 * }
 * ```
 */

// PR 4 migration: replaced ServiceError throws + mapLegacy/mapSimple helpers
// with NextlyError factories. Identifiers (mediaId/folderId/etc) move to
// logContext per §13.8; public messages remain generic and end with a period.
import { NextlyError } from "../../../errors";
import { normalizeDbTimestamp } from "../../../lib/date-formatting";
import type { MediaService as LegacyMediaService } from "../../../services/media";
import type {
  MediaFolderService as LegacyFolderService,
  MediaFolder as LegacyMediaFolder,
  CreateFolderInput as LegacyCreateFolderInput,
  UpdateFolderInput as LegacyUpdateFolderInput,
} from "../../../services/media-folder";
import { stripHtmlTags } from "../../../services/security/sanitization-service";
import type {
  RequestContext,
  PaginatedResult,
  Logger,
} from "../../../services/shared";
import { consoleLogger } from "../../../services/shared";
import type { IStorageAdapter } from "../../../storage/adapters/base-adapter";
import type { ImageProcessor } from "../../../storage/image-processor";
import {
  isImageMimeType,
  validateFileSize,
  type MediaParams,
  type Media as LegacyMedia,
} from "../../../types/media";
import type {
  MediaFile,
  UploadMediaInput,
  UpdateMediaInput,
  ListMediaOptions,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContents,
  BulkOperationResult,
  BulkUploadOperationResult,
} from "../types";

export type {
  MediaFile,
  MediaType,
  UploadMediaInput,
  UpdateMediaInput,
  ListMediaOptions,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContents,
  BulkOperationResult,
  BulkUploadOperationResult,
} from "../types";

/**
 * Extended row type for media data from legacy services or raw DB queries.
 * Includes both camelCase (service) and snake_case (raw DB) field variants.
 */
interface MediaRow extends LegacyMedia {
  folderId?: string | null;
  uploaded_at?: Date | string;
  updated_at?: Date | string;
}

/**
 * Extended row type for folder data from legacy services or raw DB queries.
 */
interface MediaFolderRow extends LegacyMediaFolder {
  created_at?: Date | string;
  updated_at?: Date | string;
}

// ============================================================
// Sanitization Helpers
// ============================================================

/**
 * Sanitize media metadata fields by stripping HTML tags.
 * Processes altText, caption, and each element of tags[].
 * Mutates the input object in place for efficiency.
 */
function sanitizeMediaInput(input: {
  altText?: string | null;
  caption?: string | null;
  tags?: string[];
}): void {
  if (typeof input.altText === "string") {
    input.altText = stripHtmlTags(input.altText);
  }
  if (typeof input.caption === "string") {
    input.caption = stripHtmlTags(input.caption);
  }
  if (Array.isArray(input.tags)) {
    input.tags = input.tags.map(tag =>
      typeof tag === "string" ? stripHtmlTags(tag) : tag
    );
  }
}

export function toMediaDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  const normalized = normalizeDbTimestamp(value);
  return new Date(normalized || new Date());
}

// ============================================================
// MediaService
// ============================================================

/**
 * MediaService - Unified service for media files and folders
 *
 * Provides complete media management with:
 *
 * - Exception-based error handling (throws NextlyError)
 * - Type-safe RequestContext
 * - PaginatedResult for list operations
 * - Storage provider injection for testability
 * - Logging support
 */
export class MediaService {
  constructor(
    private readonly legacyMediaService: LegacyMediaService,
    private readonly legacyFolderService: LegacyFolderService,
    private readonly storageOrGetter:
      | IStorageAdapter
      | (() => IStorageAdapter | null)
      | null,
    private readonly imageProcessor: ImageProcessor,
    private readonly logger: Logger = consoleLogger
  ) {}

  /**
   * Get the storage adapter (supports both direct reference and getter function)
   * This allows for late-registration of storage plugins
   */
  private getStorage(): IStorageAdapter | null {
    if (typeof this.storageOrGetter === "function") {
      return this.storageOrGetter();
    }
    return this.storageOrGetter;
  }

  /**
   * Ensure storage is configured before media operations
   * @throws NextlyError(VALIDATION_ERROR) if storage is not configured.
   */
  private ensureStorageConfigured(): IStorageAdapter {
    const storage = this.getStorage();
    if (!storage) {
      // Per §13.8 the per-error message names the field but never the value.
      // Operator hint stays in logContext.
      throw NextlyError.validation({
        errors: [
          {
            path: "storage",
            code: "MISSING",
            message: "Storage is not configured.",
          },
        ],
        logContext: {
          reason: "missing-storage-plugin",
          hint: "Add storage: getStorageFromEnv() to your nextly.config.ts",
        },
      });
    }
    return storage;
  }

  // ============================================================
  // Media File Operations
  // ============================================================

  /**
   * Upload a media file
   *
   * @param input - Upload data (buffer, filename, mimeType, size)
   * @param context - Request context with user info
   * @returns Uploaded media file
   * @throws NextlyError if upload fails (e.g., invalid file, size limit).
   *
   * @example
   * ```typescript
   * const file = await service.upload({
   *   buffer: fileBuffer,
   *   filename: 'photo.jpg',
   *   mimeType: 'image/jpeg',
   *   size: 1024000,
   * }, context);
   * ```
   */
  async upload(
    input: UploadMediaInput,
    context: RequestContext
  ): Promise<MediaFile> {
    // Ensure storage is configured before upload
    this.ensureStorageConfigured();

    this.logger.debug("Uploading media file", {
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      userId: context.user?.id,
    });

    // Validate file size. Field-level message names the path ("size") but
    // never the value; the actual byte count + driver-supplied reason live
    // in logContext for operators.
    const sizeValidation = validateFileSize(input.size);
    if (!sizeValidation.valid) {
      throw NextlyError.validation({
        errors: [
          {
            path: "size",
            code: "INVALID",
            message: "File size is invalid.",
          },
        ],
        logContext: {
          actualSize: input.size,
          reason: sizeValidation.error || "Invalid file size",
        },
      });
    }

    // Sanitize metadata fields before storage (defense-in-depth)
    sanitizeMediaInput(input);

    const result = await this.legacyMediaService.uploadMedia({
      file: input.buffer,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      // null when no user is present (CLI seeds, system imports).
      // The media.uploaded_by column is nullable to allow this case.
      uploadedBy: context.user?.id ?? null,
    });

    if (!result.success || !result.data) {
      this.logger.warn("Media upload failed", {
        filename: input.filename,
        message: result.message,
        statusCode: result.statusCode,
      });
      throw this.mapLegacyErrorToNextlyError(result);
    }

    // Move to folder if specified
    if (input.folderId) {
      await this.moveToFolder(result.data.id, input.folderId, context);
    }

    this.logger.info("Media file uploaded", {
      mediaId: result.data.id,
      filename: result.data.filename,
    });

    return this.mapToMediaFile(result.data);
  }

  /**
   * Find a media file by ID
   *
   * @param mediaId - Media file ID
   * @param context - Request context
   * @returns Media file data
   * @throws NextlyError(NOT_FOUND) if the file doesn't exist.
   */
  async findById(
    mediaId: string,
    _context: RequestContext
  ): Promise<MediaFile> {
    this.logger.debug("Finding media by ID", { mediaId });

    const result = await this.legacyMediaService.getMediaById(mediaId);

    if (!result.success || !result.data) {
      // §13.8: generic "Not found." with mediaId only in logContext.
      throw NextlyError.notFound({
        logContext: { entity: "media", mediaId },
      });
    }

    return this.mapToMediaFile(result.data);
  }

  /**
   * List media files with pagination and filtering
   *
   * @param options - Query options (pagination, search, filters)
   * @param context - Request context
   * @returns Paginated list of media files
   */
  async listMedia(
    options: ListMediaOptions = {},
    _context: RequestContext
  ): Promise<PaginatedResult<MediaFile>> {
    this.logger.debug("Listing media files", { options });

    const page = options.page ?? 1;
    const limit = options.limit ?? 24;

    const queryParams: MediaParams = {
      page,
      limit,
      search: options.search,
      type: options.type,
      folderId: options.folderId,
      sortBy: options.sortBy ?? "uploadedAt",
      sortOrder: options.sortOrder ?? "desc",
    };

    const result = await this.legacyMediaService.listMedia(queryParams);

    if (!result.success) {
      throw this.mapLegacyErrorToNextlyError(result);
    }

    const files = (result.data ?? []).map(m => this.mapToMediaFile(m));
    const total = result.meta?.total ?? files.length;
    const offset = (page - 1) * limit;

    return {
      data: files,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + files.length < total,
      },
    };
  }

  /**
   * Update media file metadata
   *
   * @param mediaId - Media file ID
   * @param input - Update data
   * @param context - Request context
   * @returns Updated media file
   * @throws NextlyError if update fails.
   */
  async update(
    mediaId: string,
    input: UpdateMediaInput,
    _context: RequestContext
  ): Promise<MediaFile> {
    this.logger.debug("Updating media file", { mediaId, input });

    // Sanitize metadata fields before storage (defense-in-depth)
    sanitizeMediaInput(input);

    const result = await this.legacyMediaService.updateMedia(mediaId, {
      altText: input.altText ?? undefined,
      caption: input.caption ?? undefined,
      tags: input.tags,
    });

    if (!result.success || !result.data) {
      if (result.statusCode === 404) {
        // §13.8: generic "Not found." with mediaId only in logContext.
        throw NextlyError.notFound({
          logContext: { entity: "media", mediaId },
        });
      }
      throw this.mapLegacyErrorToNextlyError(result);
    }

    this.logger.info("Media file updated", { mediaId });

    return this.mapToMediaFile(result.data);
  }

  /**
   * Delete a media file
   *
   * @param mediaId - Media file ID
   * @param context - Request context
   * @throws NextlyError if deletion fails.
   */
  async delete(mediaId: string, _context: RequestContext): Promise<void> {
    this.logger.debug("Deleting media file", { mediaId });

    const result = await this.legacyMediaService.deleteMedia(mediaId);

    if (!result.success) {
      if (result.statusCode === 404) {
        // §13.8: generic "Not found." with mediaId only in logContext.
        throw NextlyError.notFound({
          logContext: { entity: "media", mediaId },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result);
    }

    this.logger.info("Media file deleted", { mediaId });
  }

  /**
   * Upload multiple files.
   *
   * Phase 4.5: returns BulkUploadOperationResult<MediaFile>. Successes
   * carry the newly-created MediaFile records (with assigned ids); failures
   * are positional (no id, since the upload never made it that far) and
   * carry canonical NextlyErrorCode + public-safe message.
   *
   * @param inputs - Array of files to upload
   * @param context - Request context
   * @returns Bulk-upload operation result with full MediaFile on success
   */
  async bulkUpload(
    inputs: UploadMediaInput[],
    context: RequestContext
  ): Promise<BulkUploadOperationResult<MediaFile>> {
    this.logger.debug("Bulk uploading media files", { count: inputs.length });

    // Phase 4.5: per-file uploads run concurrently via Promise.allSettled
    // so the wall time matches today's client-side fan-out pattern. Each
    // closure resolves to a discriminated outcome (success|failure); we
    // partition into successes/failures arrays after all settle. The
    // db connection pool and storage adapter throttle real concurrency.
    type UploadOutcome =
      | { kind: "success"; file: MediaFile }
      | {
          kind: "failure";
          index: number;
          filename: string;
          code: string;
          message: string;
        };

    const outcomes = await Promise.allSettled(
      inputs.map(async (input, i): Promise<UploadOutcome> => {
        try {
          const file = await this.upload(input, context);
          return { kind: "success", file };
        } catch (error) {
          // NextlyError thrown from below the boundary preserves canonical
          // code + publicMessage. Anything else maps to INTERNAL_ERROR; the
          // operator log carries full detail (no public leak per spec §13.8).
          if (NextlyError.is(error)) {
            return {
              kind: "failure",
              index: i,
              filename: input.filename,
              code: String(error.code),
              message: error.publicMessage,
            };
          }
          this.logger.warn("Bulk upload item failed (non-NextlyError)", {
            filename: input.filename,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            kind: "failure",
            index: i,
            filename: input.filename,
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
          };
        }
      })
    );

    const successes: MediaFile[] = [];
    const failures: BulkUploadOperationResult<MediaFile>["failures"] = [];

    outcomes.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        const value = outcome.value;
        if (value.kind === "success") {
          successes.push(value.file);
        } else {
          failures.push({
            index: value.index,
            filename: value.filename,
            code: value.code,
            message: value.message,
          });
        }
      } else {
        // Defensive: per-item closure rejected unexpectedly (the closure
        // already has a catch, so this should not happen). Surface as
        // INTERNAL_ERROR rather than swallowing.
        const filename = inputs[i]?.filename ?? `file-${i}`;
        failures.push({
          index: i,
          filename,
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        });
      }
    });

    return {
      successes,
      failures,
      total: inputs.length,
      successCount: successes.length,
      failedCount: failures.length,
    };
  }

  /**
   * Delete multiple media files.
   *
   * Phase 4.5: returns BulkOperationResult<{id}>. Successes carry the
   * deleted ids; failures are id-keyed with canonical NextlyErrorCode.
   *
   * @param mediaIds - Array of media IDs to delete
   * @param context - Request context
   * @returns Bulk operation result with id-only successes
   */
  async bulkDelete(
    mediaIds: string[],
    context: RequestContext
  ): Promise<BulkOperationResult<{ id: string }>> {
    this.logger.debug("Bulk deleting media files", { count: mediaIds.length });

    // Phase 4.5: per-id deletions run concurrently via Promise.allSettled.
    // Same rationale as bulkUpload: HTTP single round-trip plus parallel
    // server-side processing matches today's wall-time. Per-row hooks
    // and access control still fire (each closure calls the single-item
    // delete method which preserves the full pipeline).
    type DeleteOutcome =
      | { kind: "success"; id: string }
      | { kind: "failure"; id: string; code: string; message: string };

    const outcomes = await Promise.allSettled(
      mediaIds.map(async (mediaId): Promise<DeleteOutcome> => {
        try {
          await this.delete(mediaId, context);
          return { kind: "success", id: mediaId };
        } catch (error) {
          if (NextlyError.is(error)) {
            return {
              kind: "failure",
              id: mediaId,
              code: String(error.code),
              message: error.publicMessage,
            };
          }
          this.logger.warn("Bulk delete item failed (non-NextlyError)", {
            mediaId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            kind: "failure",
            id: mediaId,
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
          };
        }
      })
    );

    const successes: Array<{ id: string }> = [];
    const failures: BulkOperationResult<{ id: string }>["failures"] = [];

    outcomes.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        const value = outcome.value;
        if (value.kind === "success") {
          successes.push({ id: value.id });
        } else {
          failures.push({
            id: value.id,
            code: value.code,
            message: value.message,
          });
        }
      } else {
        // Defensive: per-item closure rejected unexpectedly. Surface as
        // INTERNAL_ERROR rather than swallowing.
        failures.push({
          id: mediaIds[i] ?? "",
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        });
      }
    });

    return {
      successes,
      failures,
      total: mediaIds.length,
      successCount: successes.length,
      failedCount: failures.length,
    };
  }

  /**
   * Move a media file to a folder
   *
   * @param mediaId - Media file ID
   * @param folderId - Target folder ID (null for root)
   * @param context - Request context
   * @throws NextlyError if move fails.
   */
  async moveToFolder(
    mediaId: string,
    folderId: string | null,
    _context: RequestContext
  ): Promise<void> {
    this.logger.debug("Moving media to folder", { mediaId, folderId });

    const result = await this.legacyFolderService.moveMediaToFolder(
      mediaId,
      folderId
    );

    if (!result.success) {
      if (result.statusCode === 404) {
        // Driver text moves into logContext per §13.8 — only generic "Not found."
        // hits the wire. The legacyMessage is kept operator-side for diagnostics.
        throw NextlyError.notFound({
          logContext: {
            entity: "media",
            mediaId,
            folderId,
            legacyMessage: result.message,
          },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result);
    }

    this.logger.info("Media moved to folder", { mediaId, folderId });
  }

  /**
   * Get storage type
   *
   * @returns Storage type string ('local', 'vercel-blob', 's3', 'r2'), or 'none' if not configured
   */
  getStorageType(): string {
    return this.getStorage()?.getType() ?? "none";
  }

  /**
   * Check if storage is configured
   */
  hasStorage(): boolean {
    return this.getStorage() !== null;
  }

  // ============================================================
  // Folder Operations
  // ============================================================

  /**
   * Create a new folder
   *
   * @param input - Folder data
   * @param context - Request context
   * @returns Created folder
   * @throws NextlyError if creation fails.
   */
  async createFolder(
    input: CreateFolderInput,
    context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Creating folder", {
      name: input.name,
      parentId: input.parentId,
    });

    const legacyInput: LegacyCreateFolderInput = {
      name: input.name,
      description: input.description,
      parentId: input.parentId ?? undefined,
      createdBy: context.user?.id ?? "anonymous",
    };

    const result = await this.legacyFolderService.createFolder(legacyInput);

    if (!result.success || !result.data) {
      if (result.statusCode === 404) {
        // Generic NOT_FOUND — parentId stays operator-side.
        throw NextlyError.notFound({
          logContext: {
            entity: "folder",
            reason: "parent-folder-missing",
            parentId: input.parentId,
          },
        });
      }
      if (result.statusCode === 409) {
        // Generic "Resource already exists." per §13.8 — name stays operator-side.
        throw NextlyError.duplicate({
          logContext: {
            entity: "folder",
            reason: "folder-name-conflict",
            name: input.name,
            legacyMessage: result.message,
          },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result);
    }

    this.logger.info("Folder created", { folderId: result.data.id });

    return this.mapToMediaFolder(result.data);
  }

  /**
   * Find a folder by ID
   *
   * @param folderId - Folder ID
   * @param context - Request context
   * @returns Folder data
   * @throws NextlyError(NOT_FOUND) if the folder doesn't exist.
   */
  async findFolderById(
    folderId: string,
    _context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Finding folder by ID", { folderId });

    const result = await this.legacyFolderService.getFolderById(folderId);

    if (!result.success || !result.data) {
      // §13.8: generic "Not found." with folderId only in logContext.
      throw NextlyError.notFound({
        logContext: { entity: "folder", folderId },
      });
    }

    return this.mapToMediaFolder(result.data);
  }

  /**
   * List root folders
   *
   * @param context - Request context
   * @returns List of root folders
   */
  async listRootFolders(_context: RequestContext): Promise<MediaFolder[]> {
    this.logger.debug("Listing root folders");

    const result = await this.legacyFolderService.listRootFolders();

    if (!result.success) {
      throw this.mapSimpleErrorToNextlyError(result);
    }

    return (result.data ?? []).map(f => this.mapToMediaFolder(f));
  }

  /**
   * List subfolders of a folder
   *
   * @param parentId - Parent folder ID
   * @param context - Request context
   * @returns List of subfolders
   */
  async listSubfolders(
    parentId: string,
    _context: RequestContext
  ): Promise<MediaFolder[]> {
    this.logger.debug("Listing subfolders", { parentId });

    const result = await this.legacyFolderService.listSubfolders(parentId);

    if (!result.success) {
      throw this.mapSimpleErrorToNextlyError(result);
    }

    return (result.data ?? []).map(f => this.mapToMediaFolder(f));
  }

  /**
   * Get folder contents (subfolders + files)
   *
   * @param folderId - Folder ID (null for root)
   * @param context - Request context
   * @returns Folder contents with breadcrumbs
   */
  async getFolderContents(
    folderId: string | null,
    _context: RequestContext
  ): Promise<FolderContents> {
    this.logger.debug("Getting folder contents", { folderId });

    const result = await this.legacyFolderService.getFolderContents(folderId);

    if (!result.success || !result.data) {
      if (result.statusCode === 404) {
        // §13.8: generic "Not found." with folderId only in logContext.
        throw NextlyError.notFound({
          logContext: { entity: "folder", folderId },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result);
    }

    return {
      folder: this.mapToMediaFolder(result.data.folder),
      subfolders: result.data.subfolders.map(f => this.mapToMediaFolder(f)),
      files: (result.data.mediaFiles as unknown as MediaRow[]).map(m =>
        this.mapToMediaFile(m)
      ),
      breadcrumbs: result.data.breadcrumbs,
    };
  }

  /**
   * Update a folder
   *
   * @param folderId - Folder ID
   * @param input - Update data
   * @param context - Request context
   * @returns Updated folder
   * @throws NextlyError if update fails.
   */
  async updateFolder(
    folderId: string,
    input: UpdateFolderInput,
    _context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Updating folder", { folderId, input });

    const legacyInput: LegacyUpdateFolderInput = {
      name: input.name,
      description: input.description,
      parentId: input.parentId ?? undefined,
    };

    const result = await this.legacyFolderService.updateFolder(
      folderId,
      legacyInput
    );

    if (!result.success || !result.data) {
      if (result.statusCode === 404) {
        // §13.8: generic "Not found." with folderId only in logContext.
        throw NextlyError.notFound({
          logContext: { entity: "folder", folderId },
        });
      }
      if (result.statusCode === 400) {
        // Per §13.8 the per-error message names the field but never the value;
        // driver text moves to logContext.
        throw NextlyError.validation({
          errors: [
            {
              path: "folder",
              code: "INVALID",
              message: "Folder update is invalid.",
            },
          ],
          logContext: { folderId, legacyMessage: result.message },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result);
    }

    this.logger.info("Folder updated", { folderId });

    return this.mapToMediaFolder(result.data);
  }

  /**
   * Delete a folder
   *
   * @param folderId - Folder ID
   * @param deleteContents - Whether to delete contents (default: false)
   * @param context - Request context
   * @throws NextlyError if deletion fails.
   */
  async deleteFolder(
    folderId: string,
    deleteContents: boolean = false,
    _context: RequestContext
  ): Promise<void> {
    this.logger.debug("Deleting folder", { folderId, deleteContents });

    const result = await this.legacyFolderService.deleteFolder(
      folderId,
      deleteContents
    );

    if (!result.success) {
      if (result.statusCode === 404) {
        // §13.8: generic "Not found." with folderId only in logContext.
        throw NextlyError.notFound({
          logContext: { entity: "folder", folderId },
        });
      }
      if (result.statusCode === 400) {
        // Folder-not-empty rejection. Per §13.8 the per-error message names
        // the field but never the value; the operator hint stays in logContext.
        throw NextlyError.validation({
          errors: [
            {
              path: "deleteContents",
              code: "INVALID",
              message: "Folder cannot be deleted in its current state.",
            },
          ],
          logContext: {
            folderId,
            legacyMessage: result.message,
            hint: "Set deleteContents=true to delete folder with contents",
          },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result);
    }

    this.logger.info("Folder deleted", { folderId });
  }

  // ============================================================
  // Image Processing Utilities
  // ============================================================

  /**
   * Check if a file is an image
   *
   * @param mimeType - MIME type to check
   * @returns True if the MIME type is an image type
   */
  isImage(mimeType: string): boolean {
    return isImageMimeType(mimeType);
  }

  /**
   * Validate an image buffer
   *
   * @param buffer - File buffer
   * @returns True if buffer is a valid image
   */
  async validateImage(buffer: Buffer): Promise<boolean> {
    return this.imageProcessor.isValidImage(buffer);
  }

  /**
   * Get image dimensions
   *
   * @param buffer - Image buffer
   * @returns Dimensions or null if not an image
   */
  async getImageDimensions(
    buffer: Buffer
  ): Promise<{ width: number; height: number } | null> {
    return this.imageProcessor.getDimensions(buffer);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Map legacy media data to MediaFile type
   */
  private mapToMediaFile(data: MediaRow): MediaFile {
    return {
      id: String(data.id),
      filename: data.filename,
      originalFilename: data.originalFilename ?? data.filename,
      mimeType: data.mimeType,
      size: data.size,
      width: data.width,
      height: data.height,
      duration: data.duration,
      url: data.url,
      thumbnailUrl: data.thumbnailUrl,
      altText: data.altText,
      caption: data.caption,
      tags: data.tags,
      folderId: data.folderId,
      uploadedBy: data.uploadedBy,
      uploadedAt: toMediaDate(data.uploadedAt || data.uploaded_at),
      updatedAt: toMediaDate(data.updatedAt || data.updated_at),
    };
  }

  /**
   * Map legacy folder data to MediaFolder type
   */
  private mapToMediaFolder(data: MediaFolderRow): MediaFolder {
    return {
      id: String(data.id),
      name: data.name,
      description: data.description,
      parentId: data.parentId,
      createdBy: data.createdBy,
      createdAt: toMediaDate(data.createdAt || data.created_at),
      updatedAt: toMediaDate(data.updatedAt || data.updated_at),
    };
  }

  /**
   * Convert legacy result-shape responses (`{ success, statusCode, message, data }`)
   * from the underlying MediaService/MediaFolderService into a NextlyError.
   *
   * The legacy `message` field is treated as operator-only context — it
   * frequently contains driver text or specific identifiers, neither of
   * which §13.8 allows on the public message. The legacy message is stored
   * on logContext and the factory's canonical public message is used.
   */
  private mapLegacyErrorToNextlyError(result: {
    success: boolean;
    statusCode: number;
    message: string;
    data: unknown;
  }): NextlyError {
    const { statusCode, message } = result;
    const logContext = { legacyStatusCode: statusCode, legacyMessage: message };

    switch (statusCode) {
      case 400:
        // We don't know the offending field here, so use a generic
        // "request" path; driver text stays in logContext.
        return NextlyError.validation({
          errors: [
            {
              path: "request",
              code: "INVALID",
              message: "Request is invalid.",
            },
          ],
          logContext,
        });
      case 401:
        return NextlyError.authRequired({ logContext });
      case 403:
        return NextlyError.forbidden({ logContext });
      case 404:
        return NextlyError.notFound({ logContext });
      case 409:
        return NextlyError.duplicate({ logContext });
      case 422:
        // BUSINESS_RULE_VIOLATION has no factory — build directly per spec.
        return new NextlyError({
          code: "BUSINESS_RULE_VIOLATION",
          publicMessage:
            "The operation could not be completed due to a business rule.",
          statusCode: 422,
          logContext,
        });
      default:
        return NextlyError.internal({ logContext });
    }
  }

  /**
   * Convert the simple legacy result-shape (no `data` field) into a
   * NextlyError. Thin adapter over the full mapper.
   */
  private mapSimpleErrorToNextlyError(result: {
    success: boolean;
    statusCode: number;
    message: string;
  }): NextlyError {
    return this.mapLegacyErrorToNextlyError({
      ...result,
      data: null,
    });
  }
}

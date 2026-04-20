/**
 * MediaService - Unified service for media file and folder operations
 *
 * This service provides a clean API for both media file operations (upload, delete, etc.)
 * and folder management (create, organize, move files). It follows the new service layer
 * architecture with:
 *
 * - Exception-based error handling using ServiceError
 * - RequestContext for user/locale context
 * - PaginatedResult for list operations
 * - Constructor injection for storage and image processor
 *
 * Internally delegates to the legacy MediaService and MediaFolderService for the actual
 * implementation, converting their return format to the new exception-based pattern.
 *
 * @example
 * ```typescript
 * import { MediaService, ServiceError, isServiceError } from '@revnixhq/nextly';
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
 *   if (isServiceError(error)) {
 *     console.log(error.code); // 'NOT_FOUND'
 *     console.log(error.httpStatus); // 404
 *   }
 * }
 * ```
 */

import { ServiceError } from "../../../errors";
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
 * - Exception-based error handling (throws ServiceError)
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
   * @throws ServiceError if storage is not configured
   */
  private ensureStorageConfigured(): IStorageAdapter {
    const storage = this.getStorage();
    if (!storage) {
      throw ServiceError.validation(
        "No storage plugin configured. Please configure a storage plugin (S3 or Vercel Blob) in your nextly.config.ts",
        { hint: "Add storage: getStorageFromEnv() to your config" }
      );
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
   * @throws ServiceError if upload fails (e.g., invalid file, size limit)
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

    // Validate file size
    const sizeValidation = validateFileSize(input.size);
    if (!sizeValidation.valid) {
      throw ServiceError.validation(
        sizeValidation.error || "Invalid file size",
        { actualSize: input.size }
      );
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
      throw this.mapLegacyErrorToServiceError(result);
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
   * @throws ServiceError with NOT_FOUND if file doesn't exist
   */
  async findById(
    mediaId: string,
    _context: RequestContext
  ): Promise<MediaFile> {
    this.logger.debug("Finding media by ID", { mediaId });

    const result = await this.legacyMediaService.getMediaById(mediaId);

    if (!result.success || !result.data) {
      throw ServiceError.notFound(`Media file not found: ${mediaId}`, {
        entity: "media",
        mediaId,
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
    const pageSize = options.pageSize ?? 24;

    const legacyParams: MediaParams = {
      page,
      pageSize,
      search: options.search,
      type: options.type,
      folderId: options.folderId,
      sortBy: options.sortBy ?? "uploadedAt",
      sortOrder: options.sortOrder ?? "desc",
    };

    const result = await this.legacyMediaService.listMedia(legacyParams);

    if (!result.success) {
      throw this.mapLegacyErrorToServiceError(result);
    }

    const files = (result.data ?? []).map(m => this.mapToMediaFile(m));
    const total = result.meta?.total ?? files.length;
    const offset = (page - 1) * pageSize;

    return {
      data: files,
      pagination: {
        total,
        limit: pageSize,
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
   * @throws ServiceError if update fails
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
        throw ServiceError.notFound(`Media file not found: ${mediaId}`, {
          entity: "media",
          mediaId,
        });
      }
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Media file updated", { mediaId });

    return this.mapToMediaFile(result.data);
  }

  /**
   * Delete a media file
   *
   * @param mediaId - Media file ID
   * @param context - Request context
   * @throws ServiceError if deletion fails
   */
  async delete(mediaId: string, _context: RequestContext): Promise<void> {
    this.logger.debug("Deleting media file", { mediaId });

    const result = await this.legacyMediaService.deleteMedia(mediaId);

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`Media file not found: ${mediaId}`, {
          entity: "media",
          mediaId,
        });
      }
      throw this.mapSimpleErrorToServiceError(result);
    }

    this.logger.info("Media file deleted", { mediaId });
  }

  /**
   * Upload multiple files
   *
   * @param inputs - Array of files to upload
   * @param context - Request context
   * @returns Bulk operation result
   */
  async bulkUpload(
    inputs: UploadMediaInput[],
    context: RequestContext
  ): Promise<BulkOperationResult> {
    this.logger.debug("Bulk uploading media files", { count: inputs.length });

    const results: BulkOperationResult["results"] = [];

    for (const input of inputs) {
      try {
        const file = await this.upload(input, context);
        results.push({ id: file.id, success: true });
      } catch (error) {
        results.push({
          id: input.filename,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return {
      totalItems: inputs.length,
      successCount,
      failureCount: inputs.length - successCount,
      results,
    };
  }

  /**
   * Delete multiple media files
   *
   * @param mediaIds - Array of media IDs to delete
   * @param context - Request context
   * @returns Bulk operation result
   */
  async bulkDelete(
    mediaIds: string[],
    context: RequestContext
  ): Promise<BulkOperationResult> {
    this.logger.debug("Bulk deleting media files", { count: mediaIds.length });

    const results: BulkOperationResult["results"] = [];

    for (const mediaId of mediaIds) {
      try {
        await this.delete(mediaId, context);
        results.push({ id: mediaId, success: true });
      } catch (error) {
        results.push({
          id: mediaId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return {
      totalItems: mediaIds.length,
      successCount,
      failureCount: mediaIds.length - successCount,
      results,
    };
  }

  /**
   * Move a media file to a folder
   *
   * @param mediaId - Media file ID
   * @param folderId - Target folder ID (null for root)
   * @param context - Request context
   * @throws ServiceError if move fails
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
        throw ServiceError.notFound(result.message, {
          entity: "media",
          mediaId,
          folderId,
        });
      }
      throw this.mapSimpleErrorToServiceError(result);
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
   * @throws ServiceError if creation fails
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
        throw ServiceError.notFound("Parent folder not found", {
          entity: "folder",
          parentId: input.parentId,
        });
      }
      if (result.statusCode === 409) {
        throw ServiceError.duplicate(result.message, { name: input.name });
      }
      throw this.mapSimpleErrorToServiceError(result);
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
   * @throws ServiceError with NOT_FOUND if folder doesn't exist
   */
  async findFolderById(
    folderId: string,
    _context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Finding folder by ID", { folderId });

    const result = await this.legacyFolderService.getFolderById(folderId);

    if (!result.success || !result.data) {
      throw ServiceError.notFound(`Folder not found: ${folderId}`, {
        entity: "folder",
        folderId,
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
      throw this.mapSimpleErrorToServiceError(result);
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
      throw this.mapSimpleErrorToServiceError(result);
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
        throw ServiceError.notFound(`Folder not found: ${folderId}`, {
          entity: "folder",
          folderId,
        });
      }
      throw this.mapSimpleErrorToServiceError(result);
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
   * @throws ServiceError if update fails
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
        throw ServiceError.notFound(`Folder not found: ${folderId}`, {
          entity: "folder",
          folderId,
        });
      }
      if (result.statusCode === 400) {
        throw ServiceError.validation(result.message, { folderId });
      }
      throw this.mapSimpleErrorToServiceError(result);
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
   * @throws ServiceError if deletion fails
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
        throw ServiceError.notFound(`Folder not found: ${folderId}`, {
          entity: "folder",
          folderId,
        });
      }
      if (result.statusCode === 400) {
        throw ServiceError.validation(result.message, {
          folderId,
          hint: "Set deleteContents=true to delete folder with contents",
        });
      }
      throw this.mapSimpleErrorToServiceError(result);
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
   * Convert legacy service result format to ServiceError
   */
  private mapLegacyErrorToServiceError(result: {
    success: boolean;
    statusCode: number;
    message: string;
    data: unknown;
  }): ServiceError {
    const { statusCode, message } = result;

    switch (statusCode) {
      case 400:
        return ServiceError.validation(message);
      case 401:
        return ServiceError.unauthorized(message);
      case 403:
        return ServiceError.forbidden(message);
      case 404:
        return ServiceError.notFound(message);
      case 409:
        return ServiceError.duplicate(message);
      case 422:
        return ServiceError.businessRule(message);
      default:
        return ServiceError.internal(message);
    }
  }

  /**
   * Convert simple result format to ServiceError
   */
  private mapSimpleErrorToServiceError(result: {
    success: boolean;
    statusCode: number;
    message: string;
  }): ServiceError {
    return this.mapLegacyErrorToServiceError({
      ...result,
      data: null,
    });
  }
}

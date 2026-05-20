/**
 * Upload Service
 *
 * Thin wrapper around the shared {@link UploadValidator} plus a storage
 * adapter, with `sharp`-driven thumbnail generation for images.
 * Validation logic lives in `services/upload-validation/`.
 *
 * @example
 * ```typescript
 * import { UploadService } from "nextly";
 * import { LocalStorageAdapter } from "nextly/storage";
 *
 * const uploadService = new UploadService(new LocalStorageAdapter({...}), {
 *   maxSize: 5 * 1024 * 1024,
 *   allowedMimeTypes: ["image/*", "application/pdf"],
 *   svgCsp: true,
 *   generateThumbnails: true,
 * });
 *
 * try {
 *   const result = await uploadService.upload(buffer, {
 *     filename: "photo.jpg",
 *     mimeType: "image/jpeg",
 *   });
 * } catch (err) {
 *   if (NextlyError.isValidation(err)) {
 *     // 400 — bad filename, bad MIME, polyglot, etc.
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */

import { NextlyError } from "../errors";
import type {
  IStorageAdapter,
  FileMetadata,
  UploadResult,
} from "../storage/types";

import { consoleLogger, type Logger } from "./shared";
import { UploadValidator } from "./upload-validation";

export interface UploadConfig {
  /** Maximum file size in bytes (default: 10MB). */
  maxSize?: number;
  /** Full allowlist override — replaces the defaults entirely. */
  allowedMimeTypes?: string[];
  /** Merged with `DEFAULT_ALLOWED_MIME_TYPES` when `allowedMimeTypes` is unset. */
  additionalMimeTypes?: string[];
  /**
   * Set `Content-Disposition: attachment` on stored SVGs. Forces
   * direct-navigation downloads instead of inline render — defense
   * against a hypothetical sanitizer bypass on top-level navigation.
   * @default true
   */
  svgCsp?: boolean;
  /** Whether to generate thumbnails for images (default: true). */
  generateThumbnails?: boolean;
  thumbnailSize?: { width: number; height: number };
  /** Logger for upload telemetry events. Defaults to `consoleLogger`. */
  logger?: Logger;
}

export interface UploadOptions {
  filename: string;
  /** MIME type (e.g. `image/jpeg`). */
  mimeType: string;
  /** Optional collection slug for organizing uploads. */
  collectionSlug?: string;
}

export interface UploadedFile extends UploadResult {
  /** Unique identifier (storage path). */
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Thumbnail URL for images. */
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Storage-layer operation result. Validation failures throw
 * `NextlyError.validation` rather than surface through this shape.
 */
export interface UploadServiceResult<T> {
  success: boolean;
  statusCode: number;
  message?: string;
  data?: T;
  errors?: Array<{ field?: string; message: string }>;
}

export {
  DEFAULT_ALLOWED_MIME_TYPES,
  BLOCKED_MIME_TYPES,
} from "./upload-validation/mime";
export { BLOCKED_EXTENSIONS } from "./upload-validation/extensions";

interface ResolvedConfig {
  maxSize: number;
  svgCsp: boolean;
  generateThumbnails: boolean;
  thumbnailSize: { width: number; height: number };
}

const DEFAULT_RESOLVED: ResolvedConfig = {
  maxSize: 10 * 1024 * 1024,
  svgCsp: true,
  generateThumbnails: true,
  thumbnailSize: { width: 150, height: 150 },
};

export class UploadService {
  private readonly storage: IStorageAdapter;
  private readonly config: ResolvedConfig;
  private readonly logger: Logger;
  private readonly validator: UploadValidator;

  constructor(storage: IStorageAdapter, config: UploadConfig = {}) {
    this.storage = storage;
    this.logger = config.logger ?? consoleLogger;
    this.config = {
      maxSize: config.maxSize ?? DEFAULT_RESOLVED.maxSize,
      svgCsp: config.svgCsp ?? DEFAULT_RESOLVED.svgCsp,
      generateThumbnails:
        config.generateThumbnails ?? DEFAULT_RESOLVED.generateThumbnails,
      thumbnailSize: {
        ...DEFAULT_RESOLVED.thumbnailSize,
        ...config.thumbnailSize,
      },
    };

    this.validator = new UploadValidator({
      uploads: {
        allowedMimeTypes:
          config.allowedMimeTypes && config.allowedMimeTypes.length > 0
            ? config.allowedMimeTypes
            : undefined,
        additionalMimeTypes:
          config.additionalMimeTypes && config.additionalMimeTypes.length > 0
            ? config.additionalMimeTypes
            : undefined,
      },
      limits: { fileSize: this.config.maxSize },
    });
  }

  /**
   * Upload a file with validation and optional thumbnail generation.
   *
   * @throws `NextlyError.validation` on validation failure.
   * @returns Storage-layer result; `success: false` only for 5xx storage
   *   failures (validation failures throw upstream).
   *
   * @example
   * const result = await uploadService.upload(buffer, {
   *   filename: "photo.jpg",
   *   mimeType: "image/jpeg",
   *   collectionSlug: "products",
   * });
   */
  async upload(
    file: Buffer,
    options: UploadOptions
  ): Promise<UploadServiceResult<UploadedFile>> {
    const result = await this.validator.validate({
      buffer: file,
      filename: options.filename,
      mimeType: options.mimeType,
    });

    if (!result.ok) {
      this.logger.warn("upload.rejected", {
        event: "nextly.upload.rejected",
        code: result.errors[0]?.code,
        route: "upload-service.upload",
        mimeType: options.mimeType,
        filename: options.filename,
        size: file.length,
      });

      throw NextlyError.validation({
        errors: result.errors,
        logContext: {
          ...result.logContext,
          operation: "upload-service.upload",
          collectionSlug: options.collectionSlug,
        },
      });
    }

    const validated = result.value;

    try {
      const folder = options.collectionSlug || "uploads";

      const uploadResult = await this.storage.upload(validated.buffer, {
        filename: validated.filename,
        mimeType: validated.mimeType,
        folder,
        ...(validated.isSvg &&
          this.config.svgCsp && {
            contentDisposition: "attachment" as const,
          }),
      });

      const uploadedFile: UploadedFile = {
        ...uploadResult,
        id: uploadResult.path,
        filename: validated.filename,
        mimeType: validated.mimeType,
        size: validated.buffer.length,
      };

      if (validated.mimeType.startsWith("image/")) {
        const dimensions = await this.getImageDimensions(validated.buffer);
        if (dimensions) {
          uploadedFile.width = dimensions.width;
          uploadedFile.height = dimensions.height;
        }

        if (this.config.generateThumbnails) {
          const thumbnailUrl = await this.generateThumbnail(
            validated.buffer,
            uploadResult.path,
            folder
          );
          if (thumbnailUrl) {
            uploadedFile.thumbnailUrl = thumbnailUrl;
          }
        }
      }

      return {
        success: true,
        statusCode: 201,
        message: "File uploaded successfully",
        data: uploadedFile,
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message: error instanceof Error ? error.message : "Upload failed",
        errors: [
          {
            field: "file",
            message: error instanceof Error ? error.message : "Upload failed",
          },
        ],
      };
    }
  }

  async delete(filePath: string): Promise<UploadServiceResult<void>> {
    try {
      await this.storage.delete(filePath);
      const thumbnailPath = this.getThumbnailPath(filePath);
      try {
        await this.storage.delete(thumbnailPath);
      } catch {
        // Thumbnail deletion is best-effort.
      }
      return {
        success: true,
        statusCode: 200,
        message: "File deleted successfully",
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  async getMetadata(
    filePath: string
  ): Promise<UploadServiceResult<FileMetadata>> {
    try {
      if (!this.storage.getMetadata) {
        return {
          success: false,
          statusCode: 501,
          message: "Metadata retrieval not supported by storage adapter",
        };
      }
      const metadata = await this.storage.getMetadata(filePath);
      if (!metadata) {
        return { success: false, statusCode: 404, message: "File not found" };
      }
      return { success: true, statusCode: 200, data: metadata };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to get metadata",
      };
    }
  }

  async exists(filePath: string): Promise<UploadServiceResult<boolean>> {
    try {
      const exists = await this.storage.exists(filePath);
      return { success: true, statusCode: 200, data: exists };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to check file",
      };
    }
  }

  getPublicUrl(filePath: string): string {
    return this.storage.getPublicUrl(filePath);
  }

  getStorageType(): string {
    return this.storage.getType();
  }

  private async generateThumbnail(
    buffer: Buffer,
    originalPath: string,
    folder: string
  ): Promise<string | undefined> {
    try {
      const sharp = await import("sharp");
      const { width, height } = this.config.thumbnailSize;

      const thumbBuffer = await sharp
        .default(buffer)
        .resize(width, height, { fit: "cover" })
        .jpeg({ quality: 80 })
        .toBuffer();

      const thumbFilename = this.getThumbnailFilename(originalPath);

      const thumbResult = await this.storage.upload(thumbBuffer, {
        filename: thumbFilename,
        mimeType: "image/jpeg",
        folder: `${folder}/thumbnails`,
      });

      return thumbResult.url;
    } catch {
      // Thumbnail generation is best-effort; main upload still succeeds.
      return undefined;
    }
  }

  private async getImageDimensions(
    buffer: Buffer
  ): Promise<{ width: number; height: number } | null> {
    try {
      const sharp = await import("sharp");
      const metadata = await sharp.default(buffer).metadata();
      if (metadata.width && metadata.height) {
        return { width: metadata.width, height: metadata.height };
      }
      return null;
    } catch {
      return null;
    }
  }

  private getThumbnailFilename(originalPath: string): string {
    const lastDot = originalPath.lastIndexOf(".");
    if (lastDot === -1) return `${originalPath}_thumb.jpg`;
    return `${originalPath.substring(0, lastDot)}_thumb.jpg`;
  }

  private getThumbnailPath(originalPath: string): string {
    const lastSlash = originalPath.lastIndexOf("/");
    const folder = lastSlash !== -1 ? originalPath.substring(0, lastSlash) : "";
    const filename =
      lastSlash !== -1 ? originalPath.substring(lastSlash + 1) : originalPath;
    const thumbFilename = this.getThumbnailFilename(filename);
    return folder
      ? `${folder}/thumbnails/${thumbFilename}`
      : `thumbnails/${thumbFilename}`;
  }
}

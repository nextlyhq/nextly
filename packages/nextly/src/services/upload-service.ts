/**
 * Upload Service
 *
 * Provides file upload functionality with validation, processing, and storage.
 * This service wraps the storage adapter with additional features:
 *
 * - MIME type validation (supports wildcards like "image/*")
 * - File size validation
 * - Thumbnail generation for images
 * - Standardized result format
 *
 * Unlike MediaService (which handles database operations), UploadService is
 * a lightweight storage wrapper focused on file processing without database concerns.
 *
 * @example
 * ```typescript
 * import { UploadService } from '@revnixhq/nextly';
 * import { LocalStorageAdapter } from '@revnixhq/nextly/storage';
 *
 * const storage = new LocalStorageAdapter({
 *   uploadDir: './public/uploads',
 *   publicPath: '/uploads'
 * });
 *
 * const uploadService = new UploadService(storage, {
 *   maxSize: 5 * 1024 * 1024, // 5MB
 *   allowedMimeTypes: ['image/*', 'application/pdf'],
 *   generateThumbnails: true,
 * });
 *
 * const result = await uploadService.upload(buffer, {
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 * });
 *
 * if (result.success) {
 *   console.log('Uploaded:', result.data?.url);
 * } else {
 *   console.error('Failed:', result.message);
 * }
 * ```
 */

import type { IStorageAdapter } from "../storage/adapters/base-adapter";
import type { FileMetadata, UploadResult } from "../storage/types";

// magic-byte detection (file-type) and SVG
// sanitization (isomorphic-dompurify). Both are server-side; no
// browser-bundle concerns since this module is only imported by the
// upload route handler, which is server-only.

/**
 * Configuration options for the UploadService
 */
export interface UploadConfig {
  /** Maximum file size in bytes (default: 10MB) */
  maxSize?: number;
  /** Allowed MIME types (supports wildcards like "image/*") */
  allowedMimeTypes?: string[];
  /**
   * Additional MIME types to allow beyond the defaults.
   * Merged with `DEFAULT_ALLOWED_MIME_TYPES` when `allowedMimeTypes` is not set.
   * Ignored when `allowedMimeTypes` is explicitly provided (full override).
   */
  additionalMimeTypes?: string[];
  /**
   * Serve SVG files with a restrictive CSP (`Content-Disposition: attachment`).
   * When `false`, SVGs are uploaded without the attachment disposition.
   * @default true
   */
  svgCsp?: boolean;
  /** Whether to generate thumbnails for images (default: true) */
  generateThumbnails?: boolean;
  /** Thumbnail size configuration */
  thumbnailSize?: {
    width: number;
    height: number;
  };
}

/**
 * Options for uploading a file
 */
export interface UploadOptions {
  /** Original filename */
  filename: string;
  /** MIME type (e.g., 'image/jpeg', 'video/mp4') */
  mimeType: string;
  /** Collection slug for organizing uploads (optional) */
  collectionSlug?: string;
}

/**
 * Extended upload result with thumbnail support
 */
export interface UploadedFile extends UploadResult {
  /** Unique identifier (storage path) */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Thumbnail URL (for images) */
  thumbnailUrl?: string;
  /** Image width (for images) */
  width?: number;
  /** Image height (for images) */
  height?: number;
}

/**
 * Standardized result format for upload operations
 */
export interface UploadServiceResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** HTTP status code */
  statusCode: number;
  /** Human-readable message */
  message?: string;
  /** Result data (on success) */
  data?: T;
  /** Validation/error details */
  errors?: Array<{ field?: string; message: string }>;
}

/**
 * Default allowed MIME types for file uploads.
 * Used when no custom `allowedMimeTypes` is configured.
 */
export const DEFAULT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
];

/**
 * MIME types that are unconditionally blocked for security reasons.
 * These cannot be overridden even if explicitly included in `allowedMimeTypes`.
 */
const BLOCKED_MIME_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
];

/**
 * file extensions whose execution is potentially
 * dangerous when served from the same origin as the admin UI.
 * Rejected unconditionally regardless of the client-claimed MIME type.
 * SVG is intentionally NOT blocked here — it's allowed but sanitized
 * via DOMPurify before storage (see sanitizeSvgIfNeeded).
 */
const BLOCKED_EXTENSIONS = new Set([
  // HTML / template
  "html",
  "htm",
  "xhtml",
  "xht",
  "shtml",
  "xml",
  // Server-side scripts
  "php",
  "php3",
  "php4",
  "php5",
  "phtml",
  "asp",
  "aspx",
  "jsp",
  "jspx",
  // Client-side scripts that bypass MIME sniffing
  "js",
  "mjs",
  "cjs",
  // OS-level executables
  "exe",
  "dll",
  "sh",
  "bat",
  "cmd",
  "com",
  "scr",
  "vbs",
  "msi",
  "pif",
  "cpl",
  "hta",
]);

const DEFAULT_CONFIG: Required<UploadConfig> = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: DEFAULT_ALLOWED_MIME_TYPES,
  additionalMimeTypes: [],
  svgCsp: true,
  generateThumbnails: true,
  thumbnailSize: {
    width: 150,
    height: 150,
  },
};

/**
 * UploadService - File upload with validation and processing
 *
 * Provides a clean API for file uploads with:
 * - MIME type validation (wildcards supported)
 * - File size validation
 * - Automatic thumbnail generation for images
 * - Standardized result format with success/error handling
 */
export class UploadService {
  private readonly storage: IStorageAdapter;
  private readonly config: Required<UploadConfig>;

  /**
   * Create an UploadService instance
   *
   * @param storage - Storage adapter (Local, S3, R2, Vercel Blob)
   * @param config - Upload configuration options
   */
  constructor(storage: IStorageAdapter, config: UploadConfig = {}) {
    this.storage = storage;

    // Resolve the effective allowlist:
    // 1. If explicit allowedMimeTypes provided → use as full override
    // 2. If additionalMimeTypes provided (no explicit override) → merge with defaults
    // 3. Otherwise → use defaults
    let allowedMimeTypes: string[];
    if (config.allowedMimeTypes?.length) {
      allowedMimeTypes = config.allowedMimeTypes;
    } else if (config.additionalMimeTypes?.length) {
      // Merge additional types with defaults, deduplicating
      const merged = new Set([
        ...DEFAULT_ALLOWED_MIME_TYPES,
        ...config.additionalMimeTypes,
      ]);
      allowedMimeTypes = [...merged];
    } else {
      allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES;
    }

    // Normalize all MIME types to lowercase for case-insensitive matching
    allowedMimeTypes = allowedMimeTypes.map(type => type.toLowerCase().trim());

    // Warn and filter if developer's config includes blocked MIME types
    const blockedInConfig = allowedMimeTypes.filter(type =>
      BLOCKED_MIME_TYPES.includes(type)
    );
    if (blockedInConfig.length > 0) {
      for (const type of blockedInConfig) {
        console.warn(
          `[nextly] Warning: '${type}' is in allowedMimeTypes but is blocked for security. This type will not be accepted.`
        );
      }
      allowedMimeTypes = allowedMimeTypes.filter(
        type => !BLOCKED_MIME_TYPES.includes(type)
      );
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      allowedMimeTypes,
      thumbnailSize: {
        ...DEFAULT_CONFIG.thumbnailSize,
        ...config.thumbnailSize,
      },
    };
  }

  /**
   * Upload a file with validation and optional thumbnail generation
   *
   * @param file - File content as Buffer
   * @param options - Upload options (filename, mimeType, collectionSlug)
   * @returns Upload result with success status and file data
   *
   * @example
   * ```typescript
   * const result = await uploadService.upload(buffer, {
   *   filename: 'photo.jpg',
   *   mimeType: 'image/jpeg',
   *   collectionSlug: 'products',
   * });
   *
   * if (result.success) {
   *   console.log('URL:', result.data?.url);
   *   console.log('Thumbnail:', result.data?.thumbnailUrl);
   * }
   * ```
   */
  async upload(
    file: Buffer,
    options: UploadOptions
  ): Promise<UploadServiceResult<UploadedFile>> {
    // filename + extension hygiene. Reject path
    // separators and null bytes BEFORE anything else looks at the
    // filename — defends against directory traversal and the classic
    // "filename.jpg\0.html" trick.
    const filenameValidation = validateFilename(options.filename);
    if (!filenameValidation.valid) {
      return {
        success: false,
        statusCode: 400,
        message: filenameValidation.message,
        errors: [{ field: "file", message: filenameValidation.message! }],
      };
    }

    const extension = getExtension(options.filename);
    if (extension && BLOCKED_EXTENSIONS.has(extension)) {
      const message = `File extension '.${extension}' is blocked for security reasons.`;
      return {
        success: false,
        statusCode: 400,
        message,
        errors: [{ field: "file", message }],
      };
    }

    const mimeValidation = this.validateMimeType(options.mimeType);
    if (!mimeValidation.valid) {
      return {
        success: false,
        statusCode: 400,
        message: mimeValidation.message,
        errors: [{ field: "file", message: mimeValidation.message! }],
      };
    }

    const sizeValidation = this.validateFileSize(file.length);
    if (!sizeValidation.valid) {
      return {
        success: false,
        statusCode: 400,
        message: sizeValidation.message,
        errors: [{ field: "file", message: sizeValidation.message! }],
      };
    }

    // magic-byte vs claimed-MIME mismatch.
    // file-type sniffs the actual bytes; we reject when a client
    // claims `image/jpeg` but the bytes are `text/html` (a classic
    // polyglot / forged-extension trick). Some text-only formats
    // (CSV, plain JSON, etc.) cannot be detected by signature —
    // file-type returns null in that case and we let those through.
    const magicByteCheck = await detectAndCompareMime(
      file,
      options.mimeType
    );
    if (!magicByteCheck.valid) {
      return {
        success: false,
        statusCode: 400,
        message: magicByteCheck.message,
        errors: [{ field: "file", message: magicByteCheck.message! }],
      };
    }

    // SVG sanitization. Allow SVG uploads but strip
    // <script>, on*-handlers, and javascript: URLs from the markup
    // before storage. Replaces the input buffer with the cleaned bytes.
    const sanitized = await sanitizeSvgIfNeeded(file, options.mimeType);
    if (sanitized) {
      file = sanitized;
    }

    try {
      const folder = options.collectionSlug || "uploads";

      // Upload to storage — SVGs get Content-Disposition: attachment to prevent
      // script execution when accessed via direct URL navigation (unless svgCsp is disabled)
      const isSvg = options.mimeType.toLowerCase().trim() === "image/svg+xml";
      const uploadResult = await this.storage.upload(file, {
        filename: options.filename,
        mimeType: options.mimeType,
        folder,
        ...(isSvg &&
          this.config.svgCsp && { contentDisposition: "attachment" as const }),
      });

      const uploadedFile: UploadedFile = {
        ...uploadResult,
        id: uploadResult.path,
        filename: options.filename,
        mimeType: options.mimeType,
        size: file.length,
      };

      if (options.mimeType.startsWith("image/")) {
        const dimensions = await this.getImageDimensions(file);
        if (dimensions) {
          uploadedFile.width = dimensions.width;
          uploadedFile.height = dimensions.height;
        }

        if (this.config.generateThumbnails) {
          const thumbnailUrl = await this.generateThumbnail(
            file,
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

  /**
   * Delete a file from storage
   *
   * @param filePath - Storage path of the file to delete
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * const result = await uploadService.delete('uploads/abc-123-photo.jpg');
   * if (result.success) {
   *   console.log('File deleted');
   * }
   * ```
   */
  async delete(filePath: string): Promise<UploadServiceResult<void>> {
    try {
      await this.storage.delete(filePath);

      // Also try to delete thumbnail if present
      const thumbnailPath = this.getThumbnailPath(filePath);
      try {
        await this.storage.delete(thumbnailPath);
      } catch {
        // Ignore thumbnail deletion errors
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

  /**
   * Get file metadata
   *
   * @param filePath - Storage path of the file
   * @returns File metadata or error result
   *
   * @example
   * ```typescript
   * const result = await uploadService.getMetadata('uploads/abc-123-photo.jpg');
   * if (result.success && result.data) {
   *   console.log('Size:', result.data.size);
   *   console.log('Dimensions:', result.data.width, 'x', result.data.height);
   * }
   * ```
   */
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
        return {
          success: false,
          statusCode: 404,
          message: "File not found",
        };
      }

      return {
        success: true,
        statusCode: 200,
        data: metadata,
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to get metadata",
      };
    }
  }

  /**
   * Check if a file exists in storage
   *
   * @param filePath - Storage path to check
   * @returns Result with exists boolean
   */
  async exists(filePath: string): Promise<UploadServiceResult<boolean>> {
    try {
      const exists = await this.storage.exists(filePath);
      return {
        success: true,
        statusCode: 200,
        data: exists,
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to check file",
      };
    }
  }

  /**
   * Get the public URL for a file
   *
   * @param filePath - Storage path
   * @returns Public URL string
   */
  getPublicUrl(filePath: string): string {
    return this.storage.getPublicUrl(filePath);
  }

  /**
   * Get the storage type
   *
   * @returns Storage type identifier ('local', 's3', 'r2', 'vercel-blob')
   */
  getStorageType(): string {
    return this.storage.getType();
  }

  /**
   * Validate MIME type against allowed types
   *
   * Checks blocked types first (unconditional reject), then checks against
   * the configured allowlist. Supports wildcard patterns like "image/*".
   */
  private validateMimeType(mimeType: string): {
    valid: boolean;
    message?: string;
  } {
    // Hard block: reject dangerous MIME types unconditionally
    const normalizedMime = mimeType.toLowerCase().trim();
    if (BLOCKED_MIME_TYPES.includes(normalizedMime)) {
      return {
        valid: false,
        message: `File type '${mimeType}' is blocked for security reasons and cannot be uploaded.`,
      };
    }

    // Check against the configured allowlist
    const isAllowed = this.config.allowedMimeTypes.some(allowed => {
      // Handle wildcards (e.g., "image/*" matches "image/jpeg")
      if (allowed.endsWith("/*")) {
        const prefix = allowed.slice(0, -1); // "image/*" -> "image/"
        return normalizedMime.startsWith(prefix);
      }
      // Exact match
      return normalizedMime === allowed;
    });

    if (!isAllowed) {
      return {
        valid: false,
        message: `File type '${mimeType}' is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(", ")}`,
      };
    }

    return { valid: true };
  }

  private validateFileSize(size: number): { valid: boolean; message?: string } {
    if (this.config.maxSize && size > this.config.maxSize) {
      return {
        valid: false,
        message: `File size (${this.formatBytes(size)}) exceeds maximum of ${this.formatBytes(this.config.maxSize)}`,
      };
    }
    return { valid: true };
  }

  private async generateThumbnail(
    buffer: Buffer,
    originalPath: string,
    folder: string
  ): Promise<string | undefined> {
    try {
      // Dynamic import to avoid loading sharp for non-image files
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
      // Silently fail thumbnail generation
      // Main upload still succeeds
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
    if (lastDot === -1) {
      return `${originalPath}_thumb.jpg`;
    }
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

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

// ============================================================
// file-name / extension / magic-byte / SVG
// ============================================================

function getExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

function validateFilename(filename: string): {
  valid: boolean;
  message?: string;
} {
  if (!filename || filename.length === 0) {
    return { valid: false, message: "Filename is required." };
  }
  if (filename.length > 255) {
    return { valid: false, message: "Filename is too long (max 255 chars)." };
  }
  if (filename.includes("\0")) {
    return {
      valid: false,
      message: "Filename contains a null byte (likely a polyglot attack).",
    };
  }
  if (filename.includes("/") || filename.includes("\\")) {
    return {
      valid: false,
      message:
        "Filename contains a path separator. Submit just the basename — the storage adapter handles paths.",
    };
  }
  if (/^\.+$/.test(filename)) {
    return {
      valid: false,
      message: "Filename cannot consist solely of dots.",
    };
  }
  return { valid: true };
}

async function detectAndCompareMime(
  buffer: Buffer,
  claimedMime: string
): Promise<{ valid: boolean; message?: string }> {
  // Lazy-import: file-type is server-only and ~half a meg of regex tables.
  // Keep it out of any consumer's hot path until an actual upload happens.
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    // Some legitimate text formats (CSV, plain JSON) have no magic
    // bytes. Trust the claimed MIME for those — the extension
    // blocklist already rejected the dangerous text cases.
    return { valid: true };
  }
  const claimed = claimedMime.toLowerCase().trim();
  const sniffed = detected.mime.toLowerCase();
  if (claimed !== sniffed) {
    // Allow image/jpeg vs image/jpg fluff and similar near-misses by
    // comparing the type half only.
    const claimedType = claimed.split("/")[0];
    const sniffedType = sniffed.split("/")[0];
    if (claimedType === sniffedType && claimed.includes("jpeg") && sniffed.includes("jpeg")) {
      return { valid: true };
    }
    return {
      valid: false,
      message: `File contents (${detected.mime}) do not match the declared type (${claimedMime}). Likely a polyglot or forged extension.`,
    };
  }
  return { valid: true };
}

async function sanitizeSvgIfNeeded(
  buffer: Buffer,
  mimeType: string
): Promise<Buffer | null> {
  const isSvg =
    mimeType.toLowerCase().trim() === "image/svg+xml" ||
    /^<\?xml[\s\S]*?<svg[\s>]/.test(buffer.subarray(0, 2048).toString("utf8")) ||
    /^<svg[\s>]/.test(buffer.subarray(0, 2048).toString("utf8").trimStart());
  if (!isSvg) return null;

  // Lazy-import: pulls jsdom transitively. Big.
  const { default: DOMPurify } = await import("isomorphic-dompurify");
  const dirty = buffer.toString("utf8");
  const clean = DOMPurify.sanitize(dirty, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  return Buffer.from(clean, "utf8");
}

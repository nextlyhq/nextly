/**
 * Base Storage Adapter
 *
 * Provides the IStorageAdapter interface re-export and BaseStorageAdapter
 * abstract class with common functionality for storage adapters.
 *
 * @see ../types.ts for the full IStorageAdapter interface definition
 */

import type {
  IStorageAdapter,
  StorageAdapterInfo,
  StorageType,
  UploadOptions,
  UploadResult,
} from "../types";

// Re-export types for backward compatibility
export type { IStorageAdapter, StorageAdapterInfo } from "../types";

// ============================================================
// Base Storage Adapter Abstract Class
// ============================================================

/**
 * Abstract base class for storage adapters.
 *
 * Provides common functionality and helper methods that all storage adapters
 * can use. Concrete adapters should extend this class to inherit:
 * - Default getInfo() implementation with auto-detected capabilities
 * - sanitizeFilename() helper for secure filename handling
 * - generateKey() helper for unique storage key generation
 *
 * @example
 * ```typescript
 * class MyStorageAdapter extends BaseStorageAdapter {
 *   async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
 *     const key = this.generateKey(options.filename, options.folder);
 *     const sanitized = this.sanitizeFilename(options.filename);
 *     // ... upload logic
 *   }
 *
 *   async delete(filePath: string): Promise<void> { ... }
 *   async exists(filePath: string): Promise<boolean> { ... }
 *   getPublicUrl(filePath: string): string { ... }
 *   getType(): string { return 'my-storage'; }
 * }
 * ```
 */
export abstract class BaseStorageAdapter implements IStorageAdapter {
  /**
   * Upload file buffer to storage.
   * Must be implemented by concrete adapters.
   */
  abstract upload(
    buffer: Buffer,
    options: UploadOptions
  ): Promise<UploadResult>;

  /**
   * Delete file from storage.
   * Must be implemented by concrete adapters.
   */
  abstract delete(filePath: string): Promise<void>;

  /**
   * Check if file exists in storage.
   * Must be implemented by concrete adapters.
   */
  abstract exists(filePath: string): Promise<boolean>;

  /**
   * Get public URL for file.
   * Must be implemented by concrete adapters.
   */
  abstract getPublicUrl(filePath: string): string;

  /**
   * Get storage type identifier.
   * Must be implemented by concrete adapters.
   */
  abstract getType(): string;

  /**
   * Get adapter info including capabilities.
   *
   * Default implementation that auto-detects capabilities by checking
   * if getSignedUrl and getPresignedUploadUrl methods are implemented.
   * Override in subclasses for more accurate capability reporting.
   *
   * @returns Adapter info with type, name, and capability flags
   */
  getInfo(): StorageAdapterInfo {
    // Type-safe capability detection using 'in' operator
    const hasSignedUrls =
      "getSignedUrl" in this && typeof this.getSignedUrl === "function";
    const hasClientUploads =
      "getPresignedUploadUrl" in this &&
      typeof this.getPresignedUploadUrl === "function";

    return {
      type: this.getType() as StorageType,
      name: this.constructor.name,
      supportsSignedUrls: hasSignedUrls,
      supportsClientUploads: hasClientUploads,
    };
  }

  /**
   * Sanitize filename to prevent directory traversal and storage issues.
   *
   * Security measures:
   * - Remove path separators (/, \)
   * - Keep only basename (no directories)
   * - Replace problematic characters with hyphens
   * - Preserve alphanumeric, dots, underscores, hyphens
   *
   * @param filename - Original filename to sanitize
   * @returns Sanitized filename safe for storage
   *
   * @example
   * ```typescript
   * this.sanitizeFilename('../../../etc/passwd')  // 'passwd'
   * this.sanitizeFilename('my file (1).jpg')      // 'my-file--1-.jpg'
   * this.sanitizeFilename('photo.jpg')            // 'photo.jpg'
   * ```
   */
  protected sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() || filename;
    return basename.replace(/[^a-zA-Z0-9._-]/g, "-");
  }

  /**
   * Generate a unique storage key with date-based prefix.
   *
   * Creates keys in format: {folder}/{year}/{month}/{uuid}-{sanitized-filename}
   * This provides:
   * - Unique keys via UUID to prevent collisions
   * - Date-based organization for easier management
   * - Readable filenames for debugging
   *
   * @param filename - Original filename (will be sanitized)
   * @param folder - Optional folder/prefix for organizing uploads
   * @returns Generated storage key
   *
   * @example
   * ```typescript
   * this.generateKey('photo.jpg')
   * // 'uploads/2026/01/abc-123-...-photo.jpg'
   *
   * this.generateKey('doc.pdf', 'documents')
   * // 'documents/2026/01/abc-123-...-doc.pdf'
   * ```
   */
  protected generateKey(filename: string, folder?: string): string {
    const sanitized = this.sanitizeFilename(filename);
    const uuid = crypto.randomUUID();
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    const prefix = folder
      ? `${folder}/${year}/${month}`
      : `uploads/${year}/${month}`;

    return `${prefix}/${uuid}-${sanitized}`;
  }
}

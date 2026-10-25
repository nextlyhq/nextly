/**
 * Base Storage Adapter
 *
 * BaseStorageAdapter abstract class with common functionality for storage
 * adapters. Concrete adapters extend this class to inherit auto-detected
 * capabilities, sanitizeFilename(), generateKey(), etc.
 *
 * For the IStorageAdapter interface itself, import from ../types directly.
 */

import type {
  IStorageAdapter,
  StorageAdapterInfo,
  StorageType,
  UploadOptions,
  UploadResult,
} from "../types";

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
   * // '2026/01/abc-123-...-photo.jpg'
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

    return composeStorageKey(folder, year, month, uuid, sanitized);
  }
}

/**
 * The layout of a generated key: an optional folder, the year and month,
 * then a random UUID before the sanitized name. The ONE definition: keys are
 * written through it, and {@link GENERATED_KEY} is derived from it, so the
 * writer and the recognizer cannot describe two different layouts.
 */
function composeStorageKey(
  folder: string | undefined,
  year: number | string,
  month: string,
  uuid: string,
  name: string
): string {
  const prefix = folder ? `${folder}/${year}/${month}` : `${year}/${month}`;
  return `${prefix}/${uuid}-${name}`;
}

/** Placeholders composed in place of each part, then swapped for its pattern. */
const KEY_PART_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ["\u0000F/", "(?:.+/)?"],
  ["\u0000Y", "\\d{4}"],
  ["\u0000M", "\\d{2}"],
  ["\u0000U", "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"],
  ["\u0000N", "[a-zA-Z0-9._-]+"],
];

/**
 * A key {@link BaseStorageAdapter.generateKey} wrote, recognized by
 * composing the layout with placeholders and swapping each for its pattern.
 */
const GENERATED_KEY = new RegExp(
  `^${KEY_PART_PATTERNS.reduce(
    (pattern, [placeholder, part]) => pattern.split(placeholder).join(part),
    composeStorageKey("\u0000F", "\u0000Y", "\u0000M", "\u0000U", "\u0000N")
      .split("")
      .map(char => (/[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char))
      .join("")
  )}$`
);

/**
 * Whether a stored path is one the adapters generated, and so names bytes
 * that never change.
 *
 * Every write goes through `generateKey`, which puts a fresh UUID in the
 * name, so a generated path is written once and never rewritten: a changed
 * image (a new crop, regenerated sizes) is stored under a new key. A file
 * placed in the storage folder by hand carries no such promise, which is why
 * a caller deciding how long a response may be cached asks this first.
 *
 * @param key - A stored path, relative to the storage root, with `/`
 */
export function isGeneratedStorageKey(key: string): boolean {
  return GENERATED_KEY.test(key);
}

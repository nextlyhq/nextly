/**
 * Vercel Blob Storage Adapter
 *
 * Stores files on Vercel Blob Storage, a globally distributed object storage
 * service powered by Cloudflare R2. Optimized for Vercel deployments with
 * built-in CDN distribution.
 *
 * Features:
 * - Globally distributed CDN-backed storage
 * - Automatic file management with unique filenames
 * - Token-based authentication
 * - Client-side upload support (via handleUpload API)
 * - Serverless-friendly (no filesystem access required)
 *
 * @example Basic usage
 * ```typescript
 * const adapter = new VercelBlobStorageAdapter({
 *   token: process.env.BLOB_READ_WRITE_TOKEN,
 *   collections: { media: true }
 * });
 *
 * const result = await adapter.upload(buffer, {
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg'
 * });
 * // result.url: "https://abc123.public.blob.vercel-storage.com/photo-xyz.jpg"
 * ```
 */

import type {
  IStorageAdapter,
  UploadOptions,
  UploadResult,
  StorageAdapterInfo,
  ClientUploadData,
  FileMetadata,
  BulkDeleteResult,
} from "@revnixhq/nextly/storage";
import { put, del, head, list } from "@vercel/blob";

import type {
  VercelBlobStorageConfig,
  ResolvedVercelBlobConfig,
} from "./types";

// ============================================================
// Vercel Blob Storage Adapter
// ============================================================

/**
 * Vercel Blob Storage Adapter
 *
 * Implements the IStorageAdapter interface for Vercel Blob Storage.
 * Provides file upload, deletion, existence checks, and metadata retrieval.
 */
export class VercelBlobStorageAdapter implements IStorageAdapter {
  private resolvedConfig: ResolvedVercelBlobConfig;

  /**
   * Create a new Vercel Blob storage adapter.
   *
   * @param config - Vercel Blob storage configuration
   * @throws Error if token is not provided
   */
  constructor(private config: VercelBlobStorageConfig) {
    // Resolve token from config or environment
    const token = config.token || process.env.BLOB_READ_WRITE_TOKEN || "";

    if (!token) {
      throw new Error(
        "@nextly/storage-vercel-blob: token is required.\n\n" +
          "Either set the BLOB_READ_WRITE_TOKEN environment variable or pass token in config.\n" +
          "Get your token from: Vercel Dashboard > Storage > Blob > Tokens"
      );
    }

    // Resolve config with defaults
    this.resolvedConfig = {
      token,
      addRandomSuffix: config.addRandomSuffix ?? true,
      cacheControlMaxAge: config.cacheControlMaxAge ?? 31536000,
      access: config.access ?? "public",
      storeId: config.storeId,
      allowOverwrite: config.allowOverwrite ?? false,
      multipartThreshold: config.multipartThreshold ?? 5 * 1024 * 1024, // 5MB
    };
  }

  // ============================================================
  // Core IStorageAdapter Methods
  // ============================================================

  /**
   * Upload file to Vercel Blob.
   *
   * Files are stored with globally distributed CDN backing.
   * By default, a random suffix is added to prevent filename collisions.
   *
   * @param buffer - File content as Buffer
   * @param options - Upload options (filename, mimeType, folder, collection)
   * @returns Upload result with URL and storage path
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    // Audit H14 (T-013): hard-reject SVG and HTML uploads on Vercel
    // Blob. The platform does not support per-object response headers
    // (no Content-Disposition: attachment, no CSP), so an attacker who
    // can persuade an admin to upload `evil.svg` (or `.html`) gets a
    // stored XSS that fires on every viewer hit. S3 / R2 / similar
    // adapters can enforce attachment-disposition; Vercel Blob cannot.
    const mimeType = (options.contentType || options.mimeType || "")
      .toLowerCase()
      .trim();
    const filename = (options.filename || "").toLowerCase();
    const ext = filename.includes(".")
      ? filename.slice(filename.lastIndexOf(".") + 1)
      : "";
    const isSvg =
      mimeType === "image/svg+xml" || ext === "svg" || ext === "svgz";
    const isHtml =
      mimeType === "text/html" ||
      mimeType === "application/xhtml+xml" ||
      ext === "html" ||
      ext === "htm" ||
      ext === "xhtml";
    if (isSvg || isHtml) {
      const kind = isSvg ? "SVG" : "HTML";
      throw new Error(
        `[nextly/storage-vercel-blob] ${kind} uploads are rejected on Vercel ` +
          `Blob — the platform cannot serve them with attachment-disposition ` +
          `or a restrictive CSP, so they would be stored XSS. Use the S3 / R2 ` +
          `adapter for ${kind} files, or convert to a raster format (PNG/WebP).`
      );
    }

    const pathname = this.buildPathname(options.filename, options.folder);

    const result = await put(pathname, buffer, {
      access: this.resolvedConfig.access,
      token: this.resolvedConfig.token,
      contentType: options.contentType || options.mimeType,
      addRandomSuffix: this.resolvedConfig.addRandomSuffix,
      cacheControlMaxAge: this.resolvedConfig.cacheControlMaxAge,
    });

    // Vercel Blob uses the URL as the path identifier
    return {
      url: result.url,
      path: result.url,
    };
  }

  /**
   * Delete file from Vercel Blob.
   *
   * @param filePath - Full blob URL to delete
   */
  async delete(filePath: string): Promise<void> {
    await del(filePath, {
      token: this.resolvedConfig.token,
    });
  }

  /**
   * Delete multiple files from Vercel Blob in chunked batches.
   *
   * Processes deletions in chunks of 10 concurrent calls using Promise.allSettled,
   * collecting successes and failures without short-circuiting.
   *
   * @param filePaths - Array of full blob URLs to delete
   * @returns BulkDeleteResult with successful and failed arrays
   */
  async bulkDelete(filePaths: string[]): Promise<BulkDeleteResult> {
    const successful: string[] = [];
    const failed: Array<{ filePath: string; error: string }> = [];
    const chunkSize = 10;

    for (let i = 0; i < filePaths.length; i += chunkSize) {
      const chunk = filePaths.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map(fp => del(fp, { token: this.resolvedConfig.token }))
      );

      results.forEach((result, idx) => {
        const fp = chunk[idx];
        if (result.status === "fulfilled") {
          successful.push(fp);
        } else {
          failed.push({
            filePath: fp,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      });
    }

    return { successful, failed };
  }

  /**
   * Check if file exists in Vercel Blob.
   *
   * Uses the head() function which is efficient for existence checks.
   *
   * @param filePath - Full blob URL to check
   * @returns true if file exists, false otherwise
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await head(filePath, {
        token: this.resolvedConfig.token,
      });
      return true;
    } catch {
      // Vercel Blob throws an error if the blob doesn't exist
      return false;
    }
  }

  /**
   * Get public URL for Vercel Blob file.
   *
   * Vercel Blob paths ARE the public URLs - they're already full HTTPS URLs
   * with CDN distribution.
   *
   * @param filePath - Full blob URL
   * @returns The same URL (Vercel Blob paths are already public URLs)
   */
  getPublicUrl(filePath: string): string {
    // Vercel Blob paths are already full URLs
    return filePath;
  }

  /**
   * Get storage type identifier.
   */
  getType(): "vercel-blob" {
    return "vercel-blob";
  }

  // ============================================================
  // Optional IStorageAdapter Methods
  // ============================================================

  /**
   * Get adapter info including capabilities.
   *
   * @returns Adapter info with type, name, and capability flags
   */
  getInfo(): StorageAdapterInfo {
    return {
      type: "vercel-blob",
      name: "VercelBlobStorageAdapter",
      supportsSignedUrls: false, // Vercel Blob URLs are public by default
      supportsClientUploads: true, // Via handleUpload API
    };
  }

  /**
   * Get file metadata from Vercel Blob.
   *
   * Retrieves file information including size, content type, and upload date.
   *
   * @param filePath - Full blob URL
   * @returns File metadata or null if file not found
   */
  async getMetadata(filePath: string): Promise<FileMetadata | null> {
    try {
      const result = await head(filePath, {
        token: this.resolvedConfig.token,
      });

      // Extract filename from pathname
      const filename = result.pathname.split("/").pop() || result.pathname;

      return {
        id: filePath,
        filename,
        originalFilename: filename,
        mimeType: result.contentType,
        size: result.size,
        url: result.url,
        createdAt: result.uploadedAt.toISOString(),
      };
    } catch {
      // File not found
      return null;
    }
  }

  /**
   * Generate pre-signed URL for client-side uploads.
   *
   * Vercel Blob uses a different pattern for client uploads - they require
   * the handleUpload API which handles token generation server-side.
   *
   * This method is not implemented because Vercel Blob's client upload flow
   * requires server-side route handlers with handleUpload().
   *
   * @see https://vercel.com/docs/storage/vercel-blob/client-upload
   * @throws Error always - client uploads require handleUpload API
   */
  getPresignedUploadUrl(
    _key: string,
    _mimeType: string,
    _expiresIn?: number
  ): Promise<ClientUploadData> {
    return Promise.reject(
      new Error(
        "@nextly/storage-vercel-blob: Client uploads require the handleUpload API.\n\n" +
          "Vercel Blob uses a different pattern for client-side uploads that involves:\n" +
          "1. A server-side route handler with handleUpload()\n" +
          "2. The @vercel/blob/client upload() function\n\n" +
          "See: https://vercel.com/docs/storage/vercel-blob/client-upload\n\n" +
          "For server-side uploads, use the standard upload() method instead."
      )
    );
  }

  // ============================================================
  // Additional Methods
  // ============================================================

  /**
   * List blobs with optional prefix filter.
   *
   * Useful for browsing or batch operations on stored files.
   *
   * @param prefix - Optional prefix to filter results
   * @param options - List options (limit, cursor)
   * @returns List of blob metadata
   */
  async listBlobs(
    prefix?: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<{
    blobs: Array<{
      url: string;
      pathname: string;
      size: number;
      uploadedAt: Date;
    }>;
    hasMore: boolean;
    cursor?: string;
  }> {
    const result = await list({
      token: this.resolvedConfig.token,
      prefix,
      limit: options?.limit,
      cursor: options?.cursor,
    });

    return {
      blobs: result.blobs.map(blob => ({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
      })),
      hasMore: result.hasMore,
      cursor: result.cursor,
    };
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Build pathname for Vercel Blob upload.
   *
   * Creates pathname in format: {folder}/{filename}
   * If no folder is provided, uses the filename directly.
   *
   * @param filename - Original filename (will be sanitized)
   * @param folder - Optional folder/prefix for organizing uploads
   * @returns Generated pathname
   */
  private buildPathname(filename: string, folder?: string): string {
    const sanitized = this.sanitizeFilename(filename);
    return folder ? `${folder}/${sanitized}` : sanitized;
  }

  /**
   * Sanitize filename to prevent path traversal issues.
   *
   * @param filename - Original filename
   * @returns Sanitized filename
   */
  private sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() || filename;
    return basename.replace(/[^a-zA-Z0-9._-]/g, "-");
  }

  // ============================================================
  // Public Accessors
  // ============================================================

  /**
   * Get the configured token (masked for logging).
   */
  getTokenMasked(): string {
    const token = this.resolvedConfig.token;
    if (token.length <= 8) return "****";
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  /**
   * Check if random suffix is enabled.
   */
  hasRandomSuffix(): boolean {
    return this.resolvedConfig.addRandomSuffix;
  }

  /**
   * Get configured cache control max age.
   */
  getCacheControlMaxAge(): number {
    return this.resolvedConfig.cacheControlMaxAge;
  }
}

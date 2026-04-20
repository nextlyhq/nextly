/**
 * S3 Storage Plugin
 *
 * Factory function that creates a storage plugin for AWS S3 and S3-compatible services.
 * Returns a StoragePlugin that can be registered with MediaStorage.
 *
 * @example Basic usage with AWS S3
 * ```typescript
 * import { s3Storage } from '@nextly/storage-s3'
 * import { defineConfig } from '@revnixhq/nextly/config'
 *
 * export default defineConfig({
 *   storage: [
 *     s3Storage({
 *       bucket: process.env.S3_BUCKET!,
 *       region: process.env.AWS_REGION!,
 *       accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *       secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *       collections: {
 *         media: true
 *       }
 *     })
 *   ]
 * })
 * ```
 *
 * @example With Cloudflare R2
 * ```typescript
 * s3Storage({
 *   bucket: process.env.R2_BUCKET!,
 *   region: 'auto',
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *   endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *   publicUrl: process.env.R2_PUBLIC_URL,
 *   collections: { media: true }
 * })
 * ```
 *
 * @example With collection-specific configuration
 * ```typescript
 * s3Storage({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   collections: {
 *     // Simple enable with defaults
 *     media: true,
 *
 *     // Full configuration for private documents
 *     'private-docs': {
 *       prefix: 'private/',
 *       clientUploads: true,
 *       signedDownloads: true,
 *       signedUrlExpiresIn: 3600
 *     }
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

import type { StoragePlugin, ClientUploadData } from "@revnixhq/nextly/storage";

import { S3StorageAdapter } from "./adapter";
import type { S3StorageConfig } from "./types";

// ============================================================
// Plugin Factory Function
// ============================================================

/**
 * Create an S3 storage plugin for Nextly.
 *
 * This factory function creates a StoragePlugin that can be added to
 * the `storage` array in `nextly.config.ts`. It supports:
 *
 * - AWS S3 (standard)
 * - Cloudflare R2 (S3-compatible)
 * - MinIO (S3-compatible, self-hosted)
 * - DigitalOcean Spaces (S3-compatible)
 * - Any other S3-compatible service
 *
 * @param config - S3 storage configuration
 * @returns A StoragePlugin that MediaStorage can register
 *
 * @throws Error if bucket is not provided (via adapter)
 * @throws Error if region is not provided (via adapter)
 */
export function s3Storage(config: S3StorageConfig): StoragePlugin {
  // Handle disabled plugin
  // When disabled, return a plugin with no collections and null adapter
  // MediaStorage.registerPlugin() checks for null adapter and skips registration
  if (config.enabled === false) {
    return {
      name: "s3-storage",
      type: "s3",
      collections: {},
      adapter: null as unknown as StoragePlugin["adapter"],
    };
  }

  // Create the S3 adapter
  // Adapter constructor validates required config (bucket, region)
  const adapter = new S3StorageAdapter(config);

  // Build and return the plugin
  const plugin: StoragePlugin = {
    name: "s3-storage",
    type: "s3",
    collections: config.collections,
    adapter,

    /**
     * Generate a pre-signed URL for client-side uploads.
     *
     * This allows files to be uploaded directly from the browser to S3,
     * bypassing server-side upload limits (e.g., Vercel's 4.5MB limit).
     *
     * @param filename - Original filename from the client
     * @param mimeType - MIME type of the file
     * @param collection - Collection slug this upload belongs to
     * @returns Client upload data with pre-signed URL
     */
    async getClientUploadUrl(
      filename: string,
      mimeType: string,
      collection: string
    ): Promise<ClientUploadData> {
      // Get collection-specific configuration
      const collectionConfig = config.collections[collection];
      const prefix =
        typeof collectionConfig === "object"
          ? collectionConfig.prefix
          : undefined;

      // Generate storage key matching adapter's format
      // Format: {prefix}{year}/{month}/{uuid}-{sanitized-filename}
      const key = generateStorageKey(filename, prefix);

      // Get pre-signed upload URL from adapter
      return adapter.getPresignedUploadUrl(key, mimeType);
    },

    /**
     * Generate a signed URL for private file downloads.
     *
     * Creates a time-limited URL for accessing files in private buckets.
     * Only works when collection has `signedDownloads: true`.
     *
     * @param path - Storage path/key of the file
     * @param expiresIn - URL validity duration in seconds
     * @returns Signed URL for downloading the file
     */
    async getSignedDownloadUrl(
      path: string,
      expiresIn?: number
    ): Promise<string> {
      return adapter.getSignedUrl(
        path,
        expiresIn ?? config.signedUrlExpiresIn ?? 3600
      );
    },
  };

  return plugin;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Generate a unique storage key with date-based prefix.
 *
 * Creates keys in format: {prefix}{year}/{month}/{uuid}-{sanitized-filename}
 * This matches the format used by S3StorageAdapter for consistency.
 *
 * @param filename - Original filename (will be sanitized)
 * @param prefix - Optional folder/prefix for organizing uploads
 * @returns Generated storage key
 */
function generateStorageKey(filename: string, prefix?: string): string {
  const sanitized = sanitizeFilename(filename);
  const uuid = crypto.randomUUID();
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const keyPrefix = prefix ? `${prefix}${year}/${month}` : `${year}/${month}`;

  return `${keyPrefix}/${uuid}-${sanitized}`;
}

/**
 * Sanitize filename to prevent directory traversal and S3 key issues.
 *
 * Removes path separators and replaces unsafe characters with hyphens.
 * Keeps only: a-z, A-Z, 0-9, dot, underscore, hyphen
 *
 * @param filename - Original filename
 * @returns Sanitized filename safe for S3 keys
 */
function sanitizeFilename(filename: string): string {
  // Extract basename (remove any path components)
  const basename = filename.split(/[/\\]/).pop() || filename;
  // Replace unsafe characters with hyphens
  return basename.replace(/[^a-zA-Z0-9._-]/g, "-");
}

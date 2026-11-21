/**
 * S3 Storage Plugin
 *
 * Factory function that creates a storage plugin for AWS S3 and S3-compatible services.
 * Returns a StoragePlugin that can be registered with MediaStorage.
 *
 * @example Basic usage with AWS S3
 * ```typescript
 * import { s3Storage } from '@nextly/storage-s3'
 * import { defineConfig } from 'nextly/config'
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

import type {
  ClientUploadData,
  ClientUploadOptions,
  StoragePlugin,
} from "nextly/storage";

import { S3StorageAdapter } from "./adapter";
import { generateStorageKey } from "./storage-key";
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
 * Constructing the plugin never requires the bucket or region: a missing
 * one is refused when storage is first used, not while the config loads.
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
     * @param options - The file's exact size, and the URL's lifetime
     * @returns Client upload data with pre-signed URL
     */
    async getClientUploadUrl(
      filename: string,
      mimeType: string,
      collection: string,
      options?: ClientUploadOptions
    ): Promise<ClientUploadData> {
      // Get collection-specific configuration
      const collectionConfig = config.collections[collection];
      const prefix =
        typeof collectionConfig === "object"
          ? collectionConfig.prefix
          : undefined;

      // The key a server upload under this prefix would get, from the same
      // function: {prefix}/{year}/{month}/{uuid}-{sanitized-filename}, with
      // one slash after the prefix however it is written.
      const key = generateStorageKey(filename, prefix);

      // Get pre-signed upload URL from adapter
      // Bound to the exact size, so S3 refuses any other file.
      return adapter.getPresignedUploadUrl(key, mimeType, options?.expiresIn, {
        contentLength: options?.size,
      });
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

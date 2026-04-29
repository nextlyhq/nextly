/**
 * Vercel Blob Storage Plugin
 *
 * Factory function that creates a storage plugin for Vercel Blob Storage.
 * Returns a StoragePlugin that can be registered with MediaStorage.
 *
 * @example Basic usage
 * ```typescript
 * import { vercelBlobStorage } from '@nextly/storage-vercel-blob'
 * import { defineConfig } from '@revnixhq/nextly/config'
 *
 * export default defineConfig({
 *   storage: [
 *     vercelBlobStorage({
 *       token: process.env.BLOB_READ_WRITE_TOKEN,
 *       collections: {
 *         media: true
 *       }
 *     })
 *   ]
 * })
 * ```
 *
 * @example With client uploads (recommended for Vercel)
 * ```typescript
 * vercelBlobStorage({
 *   collections: {
 *     media: {
 *       clientUploads: true // Bypass 4.5MB serverless limit
 *     }
 *   }
 * })
 * ```
 *
 * @example With collection-specific configuration
 * ```typescript
 * vercelBlobStorage({
 *   addRandomSuffix: true,
 *   cacheControlMaxAge: 86400, // 1 day
 *   collections: {
 *     // Simple enable with defaults
 *     media: true,
 *
 *     // Full configuration
 *     documents: {
 *       prefix: 'docs/',
 *       addRandomSuffix: false,
 *       allowOverwrite: true
 *     }
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

import type { StoragePlugin, ClientUploadData } from "@revnixhq/nextly/storage";

import { VercelBlobStorageAdapter } from "./adapter";
import type { VercelBlobStorageConfig } from "./types";

// ============================================================
// Plugin Factory Function
// ============================================================

/**
 * Create a Vercel Blob storage plugin for Nextly.
 *
 * This factory function creates a StoragePlugin that can be added to
 * the `storage` array in `nextly.config.ts`. Vercel Blob is optimized
 * for Vercel deployments with:
 *
 * - Global CDN distribution
 * - Simple token-based authentication
 * - Client-side upload support (via handleUpload API)
 * - Automatic file management
 *
 * @param config - Vercel Blob storage configuration
 * @returns A StoragePlugin that MediaStorage can register
 *
 * @throws Error if token is not provided (via adapter)
 */
export function vercelBlobStorage(
  config: VercelBlobStorageConfig
): StoragePlugin {
  // Handle disabled plugin
  // When disabled, return a plugin with no collections and null adapter
  // MediaStorage.registerPlugin() checks for null adapter and skips registration
  if (config.enabled === false) {
    return {
      name: "vercel-blob-storage",
      type: "vercel-blob",
      collections: {},
      adapter: null as unknown as StoragePlugin["adapter"],
    };
  }

  // Create the Vercel Blob adapter
  // Adapter constructor validates required config (token)
  const adapter = new VercelBlobStorageAdapter(config);

  // Build and return the plugin
  const plugin: StoragePlugin = {
    name: "vercel-blob-storage",
    type: "vercel-blob",
    collections: config.collections,
    adapter,

    /**
     * Generate upload URL for client-side uploads.
     *
     * Note: Vercel Blob uses a different pattern for client uploads.
     * Instead of pre-signed URLs, it uses the handleUpload() API which
     * requires server-side route handlers.
     *
     * This method throws an error explaining the correct approach.
     *
     * @see https://vercel.com/docs/storage/vercel-blob/client-upload
     */
    getClientUploadUrl(
      _filename: string,
      _mimeType: string,
      _collection: string
    ): Promise<ClientUploadData> {
      // Vercel Blob doesn't use pre-signed URLs like S3
      // Instead, it requires using the handleUpload API with @vercel/blob/client
      return Promise.reject(
        new Error(
          "@nextly/storage-vercel-blob: Client uploads require the handleUpload API.\n\n" +
            "Vercel Blob uses a different pattern than S3 for client-side uploads:\n\n" +
            "1. Create a server-side route handler with handleUpload()\n" +
            "2. Use upload() from @vercel/blob/client on the frontend\n\n" +
            "See: https://vercel.com/docs/storage/vercel-blob/client-upload"
        )
      );
    },

    /**
     * Get signed download URL for file access.
     *
     * Note: Vercel Blob URLs are public by default and do not support
     * signed/temporary URLs. All uploaded blobs are accessible via their
     * public URL.
     *
     * @param path - Storage path (full blob URL)
     * @returns The same URL (Vercel Blob URLs are public)
     */
    getSignedDownloadUrl(path: string): Promise<string> {
      // Vercel Blob URLs are public by default
      // No signed URL support - just return the public URL
      return Promise.resolve(path);
    },
  };

  return plugin;
}

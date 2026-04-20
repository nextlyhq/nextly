/**
 * Local Disk Storage Plugin
 *
 * Factory function that creates a storage plugin for local filesystem storage.
 * Used as the default storage for development when no cloud env vars are set.
 *
 * @example Zero-config (auto-detected, no explicit config needed)
 * ```typescript
 * // In nextly.config.ts — local storage is used automatically when
 * // no cloud env vars (BLOB_READ_WRITE_TOKEN, S3_BUCKET, etc.) are set.
 * export default defineConfig({
 *   storage: await getStorageFromEnv()
 * })
 * ```
 *
 * @example Explicit configuration
 * ```typescript
 * import { localStorage } from '@revnixhq/nextly/storage'
 *
 * export default defineConfig({
 *   storage: [
 *     localStorage({
 *       basePath: './public/uploads',
 *       baseUrl: '/uploads',
 *       collections: { media: true }
 *     })
 *   ]
 * })
 * ```
 */

import type { StoragePlugin } from "../types";

import { LocalStorageAdapter } from "./local-adapter";
import type { LocalStorageConfig } from "./local-types";

/**
 * Create a local disk storage plugin for Nextly.
 *
 * Files are stored on the local filesystem and served via Next.js
 * static file serving. Best for development — use cloud storage
 * (S3, Vercel Blob, Uploadthing) for production.
 *
 * @param config - Local storage configuration
 * @returns A StoragePlugin that MediaStorage can register
 */
export function localStorage(config: LocalStorageConfig): StoragePlugin {
  // Handle disabled plugin
  if (config.enabled === false) {
    return {
      name: "local-storage",
      type: "local",
      collections: {},
      adapter: null as unknown as StoragePlugin["adapter"],
    };
  }

  const adapter = new LocalStorageAdapter({
    basePath: config.basePath ?? "./public/uploads",
    baseUrl: config.baseUrl ?? "/uploads",
  });

  return {
    name: "local-storage",
    type: "local",
    collections: config.collections,
    adapter,
    // Local storage doesn't support presigned URLs or signed downloads
  };
}

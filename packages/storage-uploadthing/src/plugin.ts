/**
 * Uploadthing Storage Plugin
 *
 * Factory function that creates a storage plugin for Uploadthing.
 * Returns a StoragePlugin that can be registered with MediaStorage.
 *
 * @example
 * ```typescript
 * import { uploadthingStorage } from '@revnixhq/storage-uploadthing'
 * import { defineConfig } from '@revnixhq/nextly/config'
 *
 * export default defineConfig({
 *   storage: [
 *     uploadthingStorage({
 *       token: process.env.UPLOADTHING_TOKEN,
 *       collections: { media: true }
 *     })
 *   ]
 * })
 * ```
 */

import type { StoragePlugin } from "@revnixhq/nextly/storage";

import { UploadthingStorageAdapter } from "./adapter";
import type { UploadthingStorageConfig } from "./types";

/**
 * Create an Uploadthing storage plugin for Nextly.
 *
 * @param config - Uploadthing storage configuration
 * @returns A StoragePlugin that MediaStorage can register
 */
export function uploadthingStorage(
  config: UploadthingStorageConfig
): StoragePlugin {
  // Handle disabled plugin
  if (config.enabled === false) {
    return {
      name: "uploadthing-storage",
      type: "uploadthing",
      collections: {},
      adapter: null as unknown as StoragePlugin["adapter"],
    };
  }

  // Token from config or env
  const token = config.token ?? process.env.UPLOADTHING_TOKEN;

  if (!token) {
    console.warn(
      "[Nextly] Uploadthing token not provided. Set UPLOADTHING_TOKEN env var or pass token in config."
    );
    return {
      name: "uploadthing-storage",
      type: "uploadthing",
      collections: {},
      adapter: null as unknown as StoragePlugin["adapter"],
    };
  }

  const adapter = new UploadthingStorageAdapter({ token });

  return {
    name: "uploadthing-storage",
    type: "uploadthing",
    collections: config.collections,
    adapter,
    // Uploadthing supports client-side uploads via its own pattern
    // but we don't implement getClientUploadUrl here as it requires
    // Uploadthing's specific route handler setup
  };
}

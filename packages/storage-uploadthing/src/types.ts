/**
 * Uploadthing Storage Types
 *
 * Configuration for the @revnixhq/storage-uploadthing package.
 */

import type {
  CollectionStorageConfig,
  StoragePluginConfig,
} from "@revnixhq/nextly/storage";

/**
 * Uploadthing storage adapter configuration.
 *
 * @example
 * ```typescript
 * uploadthingStorage({
 *   token: process.env.UPLOADTHING_TOKEN,
 *   collections: { media: true }
 * })
 * ```
 */
export interface UploadthingStorageConfig extends StoragePluginConfig {
  /** Enable/disable this storage plugin (default: true). */
  enabled?: boolean;

  /** Collections this plugin handles. */
  collections: Record<string, boolean | CollectionStorageConfig>;

  /**
   * Uploadthing API token.
   * If not provided, reads from UPLOADTHING_TOKEN env var.
   */
  token?: string;
}

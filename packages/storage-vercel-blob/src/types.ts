/**
 * Vercel Blob Storage Types
 *
 * Type definitions for the @nextly/storage-vercel-blob package.
 * Optimized for Vercel deployments with client-side upload support.
 *
 * @packageDocumentation
 */

import type {
  StoragePluginConfig,
  CollectionStorageConfig,
} from "@revnixhq/nextly/storage";

// ============================================================
// Vercel Blob Storage Configuration
// ============================================================

/**
 * Vercel Blob storage adapter configuration.
 *
 * Extends the base storage plugin config with Vercel Blob-specific options.
 * Designed for seamless integration with Vercel's serverless platform.
 *
 * @example Basic usage
 * ```typescript
 * vercelBlobStorage({
 *   token: process.env.BLOB_READ_WRITE_TOKEN,
 *   collections: {
 *     media: true
 *   }
 * })
 * ```
 *
 * @example With client uploads (recommended for large files)
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
 * @example With folder prefix
 * ```typescript
 * vercelBlobStorage({
 *   collections: {
 *     media: {
 *       prefix: 'uploads/',
 *     },
 *     'private-docs': {
 *       prefix: 'documents/',
 *       clientUploads: true
 *     }
 *   }
 * })
 * ```
 */
export interface VercelBlobStorageConfig extends StoragePluginConfig {
  /** Enable/disable this storage plugin (default: true). */
  enabled?: boolean;

  /** Collections this plugin handles. */
  collections: Record<string, boolean | CollectionStorageConfig>;

  /**
   * Vercel Blob read/write token.
   *
   * If not provided, falls back to `BLOB_READ_WRITE_TOKEN` environment variable.
   * Get your token from: Vercel Dashboard > Storage > Blob > Tokens
   *
   * @example
   * ```typescript
   * token: process.env.BLOB_READ_WRITE_TOKEN
   * ```
   */
  token?: string;

  /**
   * Add a random suffix to uploaded filenames.
   * Prevents filename collisions when uploading files with the same name.
   *
   * When true, `photo.jpg` becomes `photo-abc123.jpg`
   *
   * @default true
   */
  addRandomSuffix?: boolean;

  /**
   * Cache-Control max-age in seconds.
   * Controls how long browsers and CDNs cache the files.
   *
   * Note: Vercel Blob has a minimum cache time of 1 minute.
   *
   * @default 31536000 (1 year)
   */
  cacheControlMaxAge?: number;

  /**
   * Access level for uploaded blobs.
   * Vercel Blob only supports 'public' access.
   *
   * @default 'public'
   */
  access?: "public";

  /**
   * Store ID for multi-store setups.
   * Required if you have multiple blob stores in your Vercel project.
   *
   * Get the store ID from: Vercel Dashboard > Storage > Blob > Settings
   */
  storeId?: string;

  /**
   * Whether to allow overwriting existing blobs.
   * When false, uploading a file with the same path will throw an error.
   *
   * Note: Only relevant when `addRandomSuffix` is false.
   *
   * @default false
   */
  allowOverwrite?: boolean;

  /**
   * Multipart upload threshold in bytes.
   * Files larger than this will be uploaded using multipart upload.
   *
   * @default 5242880 (5MB)
   */
  multipartThreshold?: number;
}

// ============================================================
// Vercel Blob Collection Configuration
// ============================================================

/**
 * Vercel Blob-specific collection storage configuration.
 * Extends base collection config with Vercel Blob-specific options.
 *
 * @example
 * ```typescript
 * vercelBlobStorage({
 *   collections: {
 *     // Simple enable with defaults
 *     media: true,
 *
 *     // Full configuration
 *     documents: {
 *       prefix: 'docs/',
 *       addRandomSuffix: false,
 *       allowOverwrite: true,
 *       clientUploads: true
 *     }
 *   }
 * })
 * ```
 */
export interface VercelBlobCollectionConfig extends CollectionStorageConfig {
  /**
   * Override addRandomSuffix for this collection.
   * If not set, uses the adapter-level setting.
   */
  addRandomSuffix?: boolean;

  /**
   * Override allowOverwrite for this collection.
   * If not set, uses the adapter-level setting.
   */
  allowOverwrite?: boolean;
}

// ============================================================
// Vercel Blob Collection Map Type
// ============================================================

/**
 * Type-safe collection storage map for Vercel Blob.
 * Maps collection slugs to Vercel Blob-specific configurations.
 */
export type VercelBlobCollectionStorageMap = Record<
  string,
  boolean | VercelBlobCollectionConfig
>;

// ============================================================
// Internal Types
// ============================================================

/**
 * Resolved Vercel Blob configuration after applying defaults.
 * Used internally by the adapter.
 *
 * @internal
 */
export interface ResolvedVercelBlobConfig {
  token: string;
  addRandomSuffix: boolean;
  cacheControlMaxAge: number;
  access: "public";
  storeId?: string;
  allowOverwrite: boolean;
  multipartThreshold: number;
}

/**
 * Vercel Blob put() result type.
 * Represents the response from a successful upload.
 *
 * @internal
 */
export interface VercelBlobPutResult {
  /** The publicly accessible URL of the uploaded blob */
  url: string;
  /** The download URL with Content-Disposition: attachment */
  downloadUrl: string;
  /** The pathname portion of the URL */
  pathname: string;
  /** The content type of the blob */
  contentType: string;
  /** Disposition header value */
  contentDisposition: string;
}

/**
 * Vercel Blob head() result type.
 * Represents blob metadata.
 *
 * @internal
 */
export interface VercelBlobHeadResult {
  /** The publicly accessible URL of the blob */
  url: string;
  /** The pathname portion of the URL */
  pathname: string;
  /** The content type of the blob */
  contentType: string;
  /** The size of the blob in bytes */
  size: number;
  /** When the blob was uploaded */
  uploadedAt: Date;
}

/**
 * Media Storage Module
 *
 * Unified media storage system with plugin-based architecture:
 * - AWS S3 / Cloudflare R2 / MinIO (via @revnixhq/plugin-storage-s3)
 * - Vercel Blob (via @revnixhq/plugin-storage-vercel-blob)
 * - Collection-specific storage routing
 * - Client-side uploads for serverless platforms
 * - Signed URLs for private access
 *
 * @example Basic usage
 * ```typescript
 * import { getMediaStorage, getImageProcessor } from '@revnixhq/nextly/storage';
 *
 * const storage = getMediaStorage();
 * const result = await storage.upload(buffer, {
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 *   collection: 'media'
 * });
 *
 * // Process image
 * const processor = getImageProcessor();
 * const thumbnail = await processor.generateThumbnail(buffer);
 * ```
 *
 * @example With storage plugins (in nextly.config.ts)
 * ```typescript
 * import { s3Storage } from '@revnixhq/plugin-storage-s3';
 *
 * export default defineConfig({
 *   storage: [
 *     s3Storage({
 *       bucket: process.env.S3_BUCKET!,
 *       region: process.env.AWS_REGION!,
 *       collections: {
 *         media: true,
 *         'private-docs': {
 *           prefix: 'private/',
 *           signedDownloads: true,
 *           clientUploads: true
 *         }
 *       }
 *     })
 *   ]
 * });
 * ```
 */

// ============================================================
// Core Types
// ============================================================

export type {
  // Upload types
  UploadOptions,
  UploadResult,
  // File metadata types
  FileMetadata,
  ImageMetadata,
  ProcessedImage,
  // Storage configuration types
  StorageType,
  StorageAdapterInfo,
  CollectionStorageConfig,
  CollectionStorageMap,
  // Plugin types
  StoragePluginConfig,
  StoragePlugin,
  // Client upload types
  ClientUploadData,
  // Adapter interface
  IStorageAdapter,
  BulkDeleteResult,
} from "./types";

// ============================================================
// MediaStorage Manager
// ============================================================

export {
  MediaStorage,
  initializeMediaStorage,
  getMediaStorage,
  resetMediaStorage,
} from "./storage";

export type { MediaStorageConfig } from "./storage";

// ============================================================
// Image Processor
// ============================================================

export {
  ImageProcessor,
  getImageProcessor,
  resetImageProcessor,
} from "./image-processor";

// ============================================================
// Storage Adapters
// ============================================================

export {
  // Base class for custom adapters
  BaseStorageAdapter,
} from "./adapters";

// Local disk storage adapter (core, default for development)
export { localStorage } from "./adapters/local-plugin";
export { LocalStorageAdapter } from "./adapters/local-adapter";
export type { LocalStorageConfig } from "./adapters/local-types";

// ============================================================
// Image Size Generation
// ============================================================

export { generateImageSizes, deleteImageSizes } from "./image-sizes";
export type {
  ImageSizeConfig,
  GenerateImageSizesOptions,
  UploadFn,
} from "./image-sizes";

// ============================================================
// Retry Utilities
// ============================================================

export { isTransientError, withRetry, createRetryable } from "./retry";

export type { RetryOptions } from "./retry";

// ============================================================
// SVG Security Utilities
// ============================================================

export {
  SVG_CSP_HEADER,
  isSvgMimeType,
  getSvgSecurityHeaders,
} from "./svg-security";

// ============================================================
// Auto-configuration Helper
// ============================================================

export { getStorageFromEnv } from "./env-config";

/**
 * Storage Adapters
 *
 * Storage adapters are available as plugins:
 * - @nextlyhq/storage-s3: AWS S3, Cloudflare R2, MinIO
 * - @nextlyhq/storage-vercel-blob: Vercel Blob Storage
 *
 * @example Using S3 storage
 * ```typescript
 * import { s3Storage } from '@nextlyhq/storage-s3';
 *
 * export default defineConfig({
 *   storage: {
 *     media: s3Storage({
 *       bucket: 'my-bucket',
 *       region: 'us-east-1',
 *     }),
 *   },
 * });
 * ```
 *
 * @example Using Vercel Blob storage
 * ```typescript
 * import { vercelBlobStorage } from '@nextlyhq/storage-vercel-blob';
 *
 * export default defineConfig({
 *   storage: {
 *     media: vercelBlobStorage(),
 *   },
 * });
 * ```
 *
 * @example Building custom adapters
 * ```typescript
 * import { BaseStorageAdapter, IStorageAdapter } from 'nextly/storage';
 *
 * class MyStorageAdapter extends BaseStorageAdapter {
 *   // Implement required methods...
 * }
 * ```
 */

// Base class for building custom adapters
export { BaseStorageAdapter } from "./base-adapter";

// Types for adapter implementation
export type { IStorageAdapter, StorageAdapterInfo } from "../types";
